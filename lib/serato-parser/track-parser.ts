import * as fs from 'fs';
import * as assert from 'assert';
import * as path from 'path';
import * as musicMetadata from 'music-metadata-browser';
import ByteStream from '../byte-stream';

export interface IMetadata {
    title?: string,
    artist?: string,
    album?: string,
    genre?: string[],
    bpm?: string,
    key?: string,
    location: string,
    sampleRate?: number,
    bitrate?: number,
    comment?: string[],
    size?: number,
    duration?: number,
}

// ==================
// CLASSES
// ==================

export class Track {
    metadata: IMetadata;
    cuePoints: CueEntry[];

    constructor(metadata: IMetadata, cuePoints: CueEntry[]) {
        this.metadata = metadata;
        this.cuePoints = cuePoints;
    }
}

class ColorEntry {
    static NAME = 'COLOR';

    color: string;

    constructor(data: Buffer) {
        this.color = data.toString('hex', 1); // three byte hex colour
    }
}

class CueEntry {
    static NAME = 'CUE';

    index: number;
    position: number;
    color: string;

    constructor(data: Buffer) {
        this.index = data.readUIntBE(1,1); // one byte integer
        this.position = data.readUInt32BE(2); // four byte integer
        this.color = data.toString('hex', 7, 10); // three byte hex colour
    }
}

class BPMLockEntry {
    static NAME = 'BPMLOCK';

    enabled: boolean;

    constructor(data: Buffer) {
        this.enabled = !!data.readUIntBE(0, 1); // one byte boolean
    }
}

// ====================
// FUNCTIONS
// ====================

function decodeB64Buffer(buffer: Buffer): Buffer {
    // Binary -> parse as ASCII -> Base64 and clean up newline characters
    const b64data = buffer.toString('ascii').replace(/\n/g, '');

    // ASCII (base64 encoded) -> base64 decode -> Binary
    const decodedBuffer = Buffer.from(b64data, 'base64');

    return decodedBuffer;
}

function getFrameByteStream(frameBuffer: Buffer): ByteStream {
    // Strip out the header ('erato Markers2') from the start of the frame buffer
    // so we are only left with the base64 encoded string
    const framePayloadBuffer = frameBuffer.subarray(17);

    const decodedFrameBuffer = decodeB64Buffer(framePayloadBuffer);

    // Create byte stream from decoded frame buffer
    const decodedFrameByteStream = new ByteStream(decodedFrameBuffer);

    // Assert frame header exists ('0101')
    const frameHeader = decodedFrameByteStream.read(2);
    assert(frameHeader && (frameHeader.toString('hex') === '0101'), 'Frame header is invalid');

    return decodedFrameByteStream;
}

function getEntryType(frameByteStream: ByteStream): string {
    let entryType = '';

    let nextByte = frameByteStream.read(1);
    while (nextByte && nextByte.toString('hex') !== '00') {
        entryType += nextByte.toString('binary');

        nextByte = frameByteStream.read(1);
    }

    return entryType;
}

function getEntryPayload(frameByteStream: ByteStream): Buffer | null {
    // Find entry length
    const entryLength = frameByteStream.read(4)?.readUInt32BE();
    
    // Assert the entry length is greater than 0
    assert(entryLength && entryLength > 0, 'Entry length must be greater than 0');

    return frameByteStream.read(entryLength);
}

function convertSeratoMarkers(tags: musicMetadata.IAudioMetadata): (ColorEntry | CueEntry | BPMLockEntry)[] {
    const native = tags.native?.['ID3v2.4'];

    if (native) {
        const seratoMarkers2 = native.find(frame => frame.value?.description === 'Serato Markers2');

        if (seratoMarkers2) {
            // Get byte stream of the frame data
            const frameByteStream = getFrameByteStream(seratoMarkers2.value.data);

            let entries: (ColorEntry | CueEntry | BPMLockEntry)[] = [];
            
            while (true) {
                // Get entry type
                const entryType = getEntryType(frameByteStream);

                // Break loop if no more entries
                if (!entryType) {
                    break;
                }

                // Get entry payload
                const entryPayload = getEntryPayload(frameByteStream);
                assert(entryPayload, 'Corrupted entry: Payload failed to parse');
                
                // Convert Serato tag entries
                for (const EntryClass of [ColorEntry, CueEntry, BPMLockEntry]) {
                    if (entryType === EntryClass.NAME) {
                        const entry = new EntryClass(entryPayload);
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

export function convertTrack(filePath: string): Promise<Track> {
    if (path.extname(filePath) === '.mp3') {
        const readStream = fs.createReadStream(filePath);
        let fileStats: fs.Stats;

        try {
            fileStats = fs.statSync(filePath);
        } catch (error) {
            return Promise.reject();
        }
        
        return new Promise((resolve, reject) => {
            musicMetadata.parseNodeStream(readStream)
            .then(tags => {
                // Get track metadata
                const metadata: IMetadata = {
                    title: tags.common?.title,
                    artist: tags.common?.artist,
                    album: tags.common?.album,
                    genre: tags.common?.genre,
                    bpm: tags.common?.bpm as string | undefined,
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
                const track = new Track(metadata, convertedMarkers.filter((entry): entry is CueEntry => entry instanceof CueEntry));
    
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

export function convertTracks(filePaths: string[]): Promise<Track[]> {
    const convertPromises = filePaths
        // Only supports mp3 so far
        .filter(filePath => path.extname(filePath) === '.mp3')
        .map(filePath => {
            return convertTrack(filePath);
        });
    
    // Wait for all tracks to resolve then build track map
    return Promise.all(convertPromises);
}
