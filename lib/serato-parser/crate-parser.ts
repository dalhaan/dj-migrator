import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import ByteStream from '../byte-stream';
import { IPlaylist } from '.';

interface ICrate {
    metadata?: MetadataTag,
    columns: ColumnTag[],
    tracks: TrackTag[],
    unknown: (UnknownTag | ColumnNameTag | FirstColumnTag | TrackNameTag | UnknownPayload)[],
}

class UnknownTag  {
    tagType: string;
    payload: Buffer;

    constructor(payload: Buffer, tagType: Buffer) {
        this.payload = payload;
        this.tagType = tagType.toString('ascii');
    }
}

class MetadataTag {
    static ID: Buffer = Buffer.from([0x76, 0x72, 0x73, 0x6e]); // vrsn

    metadata: string;

    constructor(payload: Buffer) {
        this.metadata = payload.swap16().toString('utf16le');
    }
}

class ColumnNameTag {
    static ID: Buffer = Buffer.from([0x74, 0x76, 0x63, 0x6e]); // tvcn

    name: string;
    
    constructor(payload: Buffer) {
        this.name = payload.swap16().toString('utf16le');
    }
}

class ColumnTag {
    static ID: Buffer = Buffer.from([0x6f, 0x76, 0x63, 0x74]); // ovct

    nameTag: ColumnNameTag;
    tag2: any;

    constructor(payload: Buffer) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream) as ColumnNameTag;
        this.tag2 = parseTag(byteStream);
    }
}

class FirstColumnTag {
    static ID: Buffer = Buffer.from([0x6f, 0x73, 0x72, 0x74]); // osrt

    nameTag: ColumnNameTag;
    tag2: any;

    constructor(payload: Buffer) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream) as ColumnNameTag;
        this.tag2 = parseTag(byteStream);
    }
}

class TrackNameTag {
    static ID: Buffer = Buffer.from([0x70, 0x74, 0x72, 0x6b]); // ptrk

    name: string;
    
    constructor(payload: Buffer) {
        this.name = payload.swap16().toString('utf16le');
    }
}

class TrackTag {
    static ID: Buffer = Buffer.from([0x6f, 0x74, 0x72, 0x6b]); // otrk

    nameTag: TrackNameTag;
    
    constructor(payload: Buffer) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream) as TrackNameTag;
    }
}

/**
 * Don't quite know what these tags are but they seem to contain the same data as ColumnTags
 */
class UnknownPayload {
    static ID: Buffer = Buffer.from([0x6f, 0x72, 0x76, 0x63]); // orvc

    payload: any;

    constructor(payload: Buffer) {
        const byteStream = new ByteStream(payload);

        if (byteStream.lookahead(4)) {
            this.payload = parseTag(byteStream);
        }
    }
}

const TAG_TYPE_TO_CLASS: {
    [tagType: string]: typeof UnknownPayload
        | typeof FirstColumnTag
        | typeof TrackTag
        | typeof ColumnTag
        | typeof TrackNameTag
        | typeof ColumnNameTag
        | typeof MetadataTag
} = {
    orvc: UnknownPayload,
    osrt: FirstColumnTag,
    otrk: TrackTag,
    ovct: ColumnTag,
    ptrk: TrackNameTag,
    tvcn: ColumnNameTag,
    vrsn: MetadataTag,
};

export function parseTag(byteStream: ByteStream) {
    // First four bytes is the tag type
    const tagType = byteStream.read(4);

    if (tagType) {
        // Next four bytes is the tag's payload length (unsigned 32-bit BE integer)
        const payloadLengthBytes = byteStream.read(4);
        assert(payloadLengthBytes, 'Corrupted tag: tag is missing payload length');
    
        const payloadLength = payloadLengthBytes.readUInt32BE();
    
        let payload = byteStream.read(payloadLength);
        assert(payload, 'Corrupted tag: tag has an invalid payload');
    
        // Parse tag if known
    
        const Tag = TAG_TYPE_TO_CLASS[tagType.toString('ascii')];
    
        if (Tag) {
            return new Tag(payload);
        }
    
        // Not a known tag
        return new UnknownTag(payload, tagType);
    }

    return null;

}

/**
 * Parse Serato crate into the crate's data
 */
export function parseCrate(cratePath: string): ICrate {
    // Assert the crate is valid
    const isValidCratePath = path.extname(cratePath) === '.crate';
    assert(isValidCratePath, `'${cratePath}' is not a valid crate. It must end in '.crate'`);

    const crateFileBuffer = fs.readFileSync(cratePath);

    const byteStream = new ByteStream(crateFileBuffer);

    let crate: ICrate = {
        columns: [],
        tracks: [],
        unknown: [],
    };

    let isTagNext = byteStream.lookahead(4);
    while (isTagNext) {
        const nextTag = parseTag(byteStream);

        if (nextTag) {
            if (nextTag instanceof ColumnTag) {
                crate.columns.push(nextTag);
            } else if (nextTag instanceof TrackTag) {
                crate.tracks.push(nextTag);
            } else if (nextTag instanceof MetadataTag) {
                crate.metadata = nextTag;
            } else {
                crate.unknown.push(nextTag);
            }
        }
        
        isTagNext = byteStream.lookahead(4);
    }

    return crate;
}

export function parseTrackNames(cratePath: string): string[] {
    const crate = parseCrate(cratePath);

    return crate.tracks.map(track => track.nameTag.name);
}

export function parseAsPlaylist(cratePath: string): IPlaylist {
    let playlist: IPlaylist = {
        name: path.basename(cratePath, path.extname(cratePath)),
        tracks: parseTrackNames(cratePath)
    }

    return playlist;
}
