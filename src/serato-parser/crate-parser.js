const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ByteStream = require('../byte-stream');

class UnknownTag {
    /** @param {Buffer} tagType
        @param {Buffer} payload */
    constructor(tagType, payload) {
        this.tagType = tagType.toString('ascii');
        this.payload = payload;
    }
}

class MetadataTag {
    static ID = Buffer.from([0x76, 0x72, 0x73, 0x6e]); // vrsn

    /** @param {Buffer} payload */
    constructor(payload) {
        this.metadata = payload.swap16().toString('utf16le');
    }
}

class ColumnNameTag {
    static ID = Buffer.from([0x74, 0x76, 0x63, 0x6e]); // tvcn

    /** @param {Buffer} payload */
    constructor(payload) {
        this.name = payload.swap16().toString('utf16le');
    }
}

class ColumnTag {
    static ID = Buffer.from([0x6f, 0x76, 0x63, 0x74]); // ovct

    /** @param {Buffer} payload */
    constructor(payload) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream);
        this.tag2 = parseTag(byteStream);
    }
}

class FirstColumnTag {
    static ID = Buffer.from([0x6f, 0x73, 0x72, 0x74]); // osrt

    /** @param {Buffer} payload */
    constructor(payload) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream);
        this.tag2 = parseTag(byteStream);
    }
}

class TrackNameTag {
    static ID = Buffer.from([0x70, 0x74, 0x72, 0x6b]); // ptrk

    /** @param {Buffer} payload */
    constructor(payload) {
        this.name = payload.swap16().toString('utf16le');
    }
}

class TrackTag {
    static ID = Buffer.from([0x6f, 0x74, 0x72, 0x6b]); // otrk

    /** @param {Buffer} payload */
    constructor(payload) {
        const byteStream = new ByteStream(payload);

        this.nameTag = parseTag(byteStream);
    }
}

/**
 * Don't quite know what these tags are but they seem to contain the same data as ColumnTags
 */
class UnknownPayload {
    static ID = Buffer.from([0x6f, 0x72, 0x76, 0x63]); // orvc

    /** @param {Buffer} payload */
    constructor(payload) {
        const byteStream = new ByteStream(payload);

        this.payload = parseTag(byteStream);
    }
}

const TAG_TYPE_TO_CLASS = {
    orvc: UnknownPayload,
    osrt: FirstColumnTag,
    otrk: TrackTag,
    ovct: ColumnTag,
    ptrk: TrackNameTag,
    tvcn: ColumnNameTag,
    vrsn: MetadataTag,
};

/** @param {ByteStream} byteStream */
function parseTag(byteStream) {
    // First four bytes is the tag type
    const tagType = byteStream.read(4);

    if (tagType) {
        // Next four bytes is the tag's payload length (unsigned 32-bit BE integer)
        const payloadLength = byteStream.read(4).readUInt32BE();

        let payload = byteStream.read(payloadLength);

        // Parse tag if known

        const Tag = TAG_TYPE_TO_CLASS[tagType.toString('ascii')];

        if (Tag) {
            return new Tag(payload);
        }

        // Not a known tag
        return new UnknownTag(tagType, payload);
    }

    // Not a valid tag
    return null;
}

/**
 * Parse Serato crate into the crate's data
 * @param {*} cratePath 
 */
function parseCrate(cratePath) {
    // Assert the crate is valid
    const isValidCratePath = path.extname(cratePath) === '.crate';
    assert(isValidCratePath, `'${cratePath}' is not a valid crate. It must end in '.crate'`);

    const crateFileBuffer = fs.readFileSync(cratePath);

    const byteStream = new ByteStream(crateFileBuffer);

    let crate = {
        columns: [],
        tracks: [],
        unknown: [],
    };

    let nextTag = parseTag(byteStream);
    while (nextTag) {
        if (nextTag instanceof ColumnTag) {
            crate.columns.push(nextTag);
        } else if (nextTag instanceof TrackTag) {
            crate.tracks.push(nextTag);
        } else if (nextTag instanceof MetadataTag) {
            crate.metadata = nextTag;
        } else {
            crate.unknown.push(nextTag);
        }
        
        nextTag = parseTag(byteStream);
    }

    return crate;
}

function parseTrackNames(cratePath) {
    const crate = parseCrate(cratePath);

    return crate.tracks.map(track => track.nameTag.name);
}

function parseAsPlaylist(cratePath) {
    let playlist = {
        name: path.basename(cratePath, path.extname(cratePath)),
        tracks: parseTrackNames(cratePath)
    }

    return playlist;
}

module.exports = { parseCrate, parseTag, parseTrackNames, parseAsPlaylist };
