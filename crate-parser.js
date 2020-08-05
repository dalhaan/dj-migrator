const fs = require('fs');
const ByteStream = require('./byte-stream');

class UnknownTag {
    /** @param {Buffer} payload */
    constructor(payload) {
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

/** @param {ByteStream} byteStream */
function parseTag(byteStream) {
    // First four bytes is the tag type
    const tagType = byteStream.read(4);

    if (tagType) {
        // Next four bytes is the tag's payload length (unsigned 32-bit BE integer)
        const payloadLength = byteStream.read(4).readUInt32BE();

        let payload = byteStream.read(payloadLength);

        // Parse tag if known
        for (Tag of [MetadataTag, ColumnTag, ColumnNameTag, TrackTag, TrackNameTag, FirstColumnTag]) {
            if (Tag.ID.equals(tagType)) {
                return new Tag(payload);
            }
        }

        // Not a known tag
        return new UnknownTag(payload);
    }

    // Not a valid tag
    return null;
}


function parseCrate(cratePath) {
    const crateFileBuffer = fs.readFileSync(cratePath);

    const byteStream = new ByteStream(crateFileBuffer);

    let crate = {
        columns: [],
        tracks: [],
    };

    let nextTag = parseTag(byteStream);
    while (nextTag) {
        if (nextTag instanceof ColumnTag) {
            crate.columns.push(nextTag);
        } else if (nextTag instanceof TrackTag) {
            crate.tracks.push(nextTag);
        }
        
        nextTag = parseTag(byteStream);
    }

    return crate;
}

function parseTrackNames(cratePath) {
    const crate = parseCrate(cratePath);

    return crate.tracks.map(track => track.nameTag.name);
}

module.exports = { parseCrate, parseTag, parseTrackNames };
