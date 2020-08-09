const musicMetadata = require('music-metadata-browser');
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const ByteStream = require('../byte-stream');

// ==================
// Type Defs
// ==================

/**
 * Track metadata typedef
 * @typedef {{
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
*      size: number,
*      duration: number,
*  }} Metadata
*/

// ==================
// CLASSES
// ==================

/**
* @module Track
*/
class Track {
    /** @param {Metadata} metadata
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

function decodeB64Buffer(buffer) {
    // Binary -> parse as ASCII -> Base64 and clean up newline characters
    const b64data = buffer.toString('ascii').replace(/\n/g, '');

    // ASCII (base64 encoded) -> base64 decode -> Binary
    const decodedBuffer = Buffer.from(b64data, 'base64');

    return decodedBuffer;
}

/**
 * 
 * @param {Buffer} frameBuffer 
 */
function getFrameByteStream(frameBuffer) {
    // Strip out the header ('erato Markers2') from the start of the frame buffer
    // so we are only left with the base64 encoded string
    const framePayloadBuffer = frameBuffer.subarray(17);

    const decodedFrameBuffer = decodeB64Buffer(framePayloadBuffer);

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
    while (nextByte && nextByte.toString('hex') !== '00') {
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

function isOfType(filePath, type) {
    const locationSplit = filePath.split('.');
    return locationSplit[locationSplit.length-1].toLowerCase() === type; 
}

function convertTrack(filePath) {
    if (isOfType(filePath, 'mp3')) {
        const readStream = fs.createReadStream(filePath);
        let fileStats;

        try {
            fileStats = fs.statSync(filePath);
        } catch (error) {
            return Promise.resolve();
        }
        
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
                    duration: tags.format?.duration,
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
    } else {
        return Promise.reject('File must be an mp3');
    }
}

function convertTracks(filePaths) {
    const convertPromises = filePaths
        // Only supports mp3 so far
        .filter(filePath => isOfType(filePath, 'mp3'))
        .map(filePath => {
            return convertTrack(filePath);
        });
    
    // Wait for all tracks to resolve then build track map
    return Promise.all(convertPromises);
}

module.exports = { convertTrack, convertTracks };
