const musicMetadata = require('music-metadata-browser');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

// ============
// Frame format
// ============
// 0 | 43 | C
// 1 | 4f | O
// 2 | 4c | L
// 3 | 4f | O
// 4 | 52 | R
// 5 | 00 |     <- first '00' signals end of entry name (our case 'COLOR')
// 6 | 00 |     <-|
// 7 | 00 |       | next four bytes (32 bits) is the payload length (our case '4')
// 8 | 00 |       |
// 9 | 04 |     <-|
// 10| 00 |     <-|
// 11| ff | ÿ     | next 'payload length' bytes contains the information of the entry
// 12| ff | ÿ     |
// 13| ff | ÿ   <-|
// ________
// 14| 43 | C   <- start of next entry
// 15| 55 | U
// 16| 45 | E
// 17| 00 |     <- first '00' signals end of entry name (our case 'CUE')
// 18| 00 |     <-|
// 19| 00 |       | next four bytes (32 bits) is the payload length (our case 0x0d -> '13')
// 20| 00 |       |
// 21| 0d |     <-|
// 22| 00 |     <- first byte is an unknown field
// 23| 00 |     <- second byte is the index (8-bit integer)
// 24| 00 |     <-|
// 25| 00 |       | next four bytes is the cue position (32-bit integer)
// 26| 80 |       | 0x0080bf -> 32959 (millis)
// 27| bf | ¿   <-|
// 28| 00 |     <- next byte is an unknown field
// 29| cc | Ì   <-|
// 30| 00 |       | next three bytes is color (our case #CC0000)
// 31| 00 |     <-|
// 32| 00 |     <-| next two bytes are unknown
// 33| 00 |     <-| 
// 34| 00 |     <-| null byte

// ==================
// CLASSES
// ==================

class ByteStream {
    constructor(buffer) {
        this.buffer = buffer;
        this.index = 0;
    }

    read(size) {
        if (this.buffer.length >= this.index + size) {
            const bytesString = this.buffer.toString('hex', this.index, this.index + size);

            this.index += size;

            return Buffer.from(bytesString, 'hex');
        }

        console.error('ByteStream: outside');

        return null;
    }
}

class Track {
    /** @param {{
     *      title: string,
     *      artist: string,
     *      album: string,
     *      genre: string[],
     *      bpm: string,
     *      key: string,
     *      location: string,
     *      sampleRate: number,
     *      bitrate: number,
     *      comment: string[],
     *      size: number
     *  }} metadata
     *  @param {CueEntry[]} cuePoints
     */
    constructor(metadata, cuePoints) {
        this.metadata = metadata;
        this.cuePoints = cuePoints;
    }
}

class ColorEntry {
    static NAME = 'COLOR';

    /** @param {Buffer} data */
    constructor(data) {
        this.color = data.toString('hex', 1); // three byte hex colour
    }
}

class CueEntry {
    static NAME = 'CUE';

    /** @param {Buffer} data */
    constructor(data) {
        this.index = data.readUIntBE(1,1); // one byte integer
        this.position = data.readUInt32BE(2); // four byte integer
        this.color = data.toString('hex', 7, 10); // three byte hex colour
    }
}

class BPMLockEntry {
    static NAME = 'BPMLOCK';

    /** @param {Buffer} data */
    constructor(data) {
        this.enabled = !!data.readUIntBE(0, 1); // one byte boolean
    }
}

// ====================
// FUNCTIONS
// ====================

function getFrameByteStream(frameBuffer) {
    // Binary -> ASCII (base64 encoded) (to clean up newline characters)
    const b64data = frameBuffer.toString('ascii', 17).replace(/\n/g, '');

    // ASCII (base64 encoded) -> base64 decode -> Binary
    const decodedFrameBuffer = Buffer.from(b64data, 'base64');

    // Create byte stream from decoded frame buffer
    const decodedFrameByteStream = new ByteStream(decodedFrameBuffer);

    // Assert frame header exists ('0101')
    const frameHeader = decodedFrameByteStream.read(2);
    assert(frameHeader.toString('hex') === '0101', 'Frame header is invalid');

    return decodedFrameByteStream;
}

function getEntryType(frameByteStream) {
    let entryType = '';

    let nextByte = frameByteStream.read(1);
    while (nextByte.toString('hex') !== '00') {
        entryType += nextByte.toString('binary');

        nextByte = frameByteStream.read(1);
    }

    return entryType;
}

function getEntryPayload(frameByteStream) {
    // Find entry length
    const entryLength = frameByteStream.read(4).readUInt32BE();
    
    // Assert the entry length is greater than 0
    assert(entryLength > 0, 'Entry length must be greater than 0');

    return frameByteStream.read(entryLength);
}

function convertSeratoMarkers(tags) {
    const native = tags.native?.['ID3v2.4'];

    if (native) {
        const seratoMarkers2 = native.find(frame => frame.value?.description === 'Serato Markers2');

        if (seratoMarkers2) {
            // Get byte stream of the frame data
            const frameByteStream = getFrameByteStream(seratoMarkers2.value.data);

            let entries = [];
            
            while (true) {
                // Get entry type
                const entryType = getEntryType(frameByteStream);

                // Break loop if no more entries
                if (!entryType) {
                    break;
                }

                // Get entry payload
                const entryPayload = getEntryPayload(frameByteStream);
                
                // Convert Serato tag entries
                for (entryClass of [ColorEntry, CueEntry, BPMLockEntry]) {
                    if (entryType === entryClass.NAME) {
                        const entry = new entryClass(entryPayload);
                        entries = [...entries, entry];
                    }
                }
            }

            return entries;
        } else {
            console.log("No 'Serato Markers2' tag");
        }
    } else {
        console.log('No native ID3v2.4 data');
    }
    
    return [];
}

function convertTracks(filePaths) {
    const convertPromises = filePaths.map(filePath => {
        const readStream = fs.createReadStream(filePath);
        const fileStats = fs.statSync(filePath);
        
        return new Promise((resolve, reject) => {
            musicMetadata.parseNodeStream(readStream)
            .then(tags => {
                // Get track metadata
                const metadata = {
                    title: tags.common?.title,
                    artist: tags.common?.artist,
                    album: tags.common?.album,
                    genre: tags.common?.genre,
                    bpm: tags.common?.bpm,
                    key: tags.common?.key,
                    sampleRate: tags.format?.sampleRate,
                    bitrate: tags.format?.bitrate,
                    comment: tags.common?.comment,
                    size: fileStats.size,
                    location: path.resolve(filePath),
                };
        
                // Convert Serato track markers
                const convertedMarkers = convertSeratoMarkers(tags);
        
                // Create Track record
                const track = new Track(metadata, convertedMarkers.filter(entry => entry instanceof CueEntry));
    
                resolve(track);
            }, reason => reject(reason))
            .finally(() => {
                readStream.destroy();
            });
        });
    });
    
    // Wait for all tracks to resolve then build track map
    return Promise.all(convertPromises);
}

function createTrackMap(filePaths) {
    return convertTracks(filePaths).then(
        (tracks) => {
            let trackMap = {};

            // Add tracks to track map for easier reference
            tracks.forEach(track => {
                trackMap = {...trackMap, [track.metadata.location]: track };
            });

            return trackMap;
        },
        rejectReason => reject(rejectReason)
    );
}

// =============================
// EXECUTION
// =============================

const FILE_PATHS = [
    './files/Stompz - Moonship.mp3',
    './files/Metrik - Fatso.mp3',
];

createTrackMap(FILE_PATHS).then(trackMap => console.log(trackMap));
