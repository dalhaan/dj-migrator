import * as fs from 'fs';
import * as assert from 'assert';
import * as path from 'path';
import * as musicMetadata from 'music-metadata-browser';
import ByteStream from '../byte-stream';

export const SUPPORTED_FILE_TYPES = ['.mp3', '.wav', '.flac'];

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
    fileExtension: string,
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

export function parseSeratoMarkers(buffer: Buffer): (ColorEntry | CueEntry | BPMLockEntry)[] {
    // Create byte stream from decoded frame buffer
    const frameByteStream = new ByteStream(buffer);

    // Assert frame header exists ('0101')
    const frameHeader = frameByteStream.read(2);
    assert(frameHeader && (frameHeader.toString('hex') === '0101'), 'Frame header is invalid');

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
}

/**
 * In FLAC Vorbis comments, marker data is stored as a base64 encoded string. Once decoded, the
 * header 'application/octet-stream\00\00Serato Markers2\00' is stripped from the decoded data
 * 
 * Process:
 *   [base64 encoded data (with newline characters)]
 *                |
 *                \/    1. strip newline characters
 *      [base64 encoded data]
 *                |
 *                \/    2. decode base64
 *   'application/octet-stream\00\00Serato Markers2\00[base64 encoded marker data (with newline characters)]'
 *                |
 *                \/    3. strip header
 *          [base64 encoded marker data (with newline characters)]
 *                |
 *                \/    4. strip newline characters again
 *          [base64 encoded marker data]
 *                |
 *                \/    5. decode base64
 *          [marker data]
 */
async function parseFlac(filePath: string) {
    // Verify that file is an MP3 or WAV
    const fileExtension = path.extname(filePath).toLowerCase();
    assert(fileExtension === '.flac', 'Must be FLAC file');

    // Verify file exists
    const doesFileExist = fs.existsSync(filePath)
    assert(doesFileExist, 'File does not exist');

    // Create read stream to parse song tags
    const readStream = fs.createReadStream(filePath);

    try {
        const fileStats = fs.statSync(filePath);

        // Parse song tags
        const tags = await musicMetadata.parseNodeStream(readStream);

        // Get track metadata for intermediary format
        const metadata: IMetadata = {
            title: tags.common?.title,
            artist: tags.common?.artist,
            album: tags.common?.album,
            genre: tags.common?.genre,
            bpm: tags.common?.bpm as string | undefined,
            key: tags.native.vorbis?.find(tag => tag.id === 'INITIALKEY')?.value,
            sampleRate: tags.format?.sampleRate,
            bitrate: 0,
            comment: tags.common?.comment,
            size: fileStats.size,
            duration: tags.format?.duration,
            location: path.resolve(filePath),
            fileExtension,
        };
    
        // Init array to hold parsed Serato markers
        let convertedMarkers: (CueEntry | ColorEntry | BPMLockEntry)[] = [];

        // Find song tag that Serato stores marker data in
        const rawVorbisData = tags.native.vorbis?.find(tag => tag.id === 'SERATO_MARKERS_V2')?.value;

        // Decode and extract markers FLAC Vorbis comment Serato marker tag
        if (rawVorbisData) {
            // Strip newline characters to normalise the base64 string
            const newlinesStripped = rawVorbisData.replace(/\n/g, '');
        
            // Decode the base64 string
            const base64Decoded = Buffer.from(newlinesStripped, 'base64');
        
            // Strip header 'application/octet-stream\00\00Serato Markers2\00' revealing the final base64 string
            const headerStripped = base64Decoded.subarray(42).toString();

            // Strip newline characters again (because Serato loves newline characters with base64)
            const newlinesStrippedAgain = headerStripped.replace(/\n/g, '');

            // Decode the remaining base64 string to get the actual marker data
            const base64DecodedAgain = Buffer.from(newlinesStrippedAgain, 'base64');
        
            // Parse the marker data for the intermediary format
            convertedMarkers = parseSeratoMarkers(base64DecodedAgain);
        }

        // Filter out all other markers apart from cues (as that is all we are interested in at this point)
        const onlyCueMarkers = convertedMarkers.filter((entry): entry is CueEntry => entry instanceof CueEntry);

        // Create intermediary format Track record
        return new Track(metadata, onlyCueMarkers);
    } finally {
        // Destroy read stream if anything goes wrong
        readStream.destroy();
    }
}

/**
 * In ID3 GEOB tags, marker data is stored as a base64 encoded string with a header prepended to it 'erato Markers2'.
 * This header is stripped before decoding the marker data.
 * 
 * Process:
 *  'erato Markers2[base64 encoded marker data (with newline characters)]'
 *                    |
 *                    \/    1. strip header
 *   [base64 encoded marker data (with newline characters)]
 *                    | 
 *                    \/    2. strip newline characters
 *          [base64 encoded marker data]
 *                    |
 *                    \/    3. decode
 *                [marker data]
 */
async function parseMp3OrWav(filePath: string) {
    // Verify that the file is an MP3 or WAV
    const fileExtension = path.extname(filePath).toLowerCase();
    assert(['.mp3', '.wav'].includes(fileExtension), 'Must be an MP3 or WAV file');
    
    // Verify that the file exists
    const doesFileExist = fs.existsSync(filePath)
    assert(doesFileExist, 'File does not exist');

    // Create read stream to parse song tags
    const readStream = fs.createReadStream(filePath);

    try {
        const fileStats = fs.statSync(filePath);

        // Parse song tags
        const tags = await musicMetadata.parseNodeStream(readStream);

        // Get track metadata for intermediary format
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
            fileExtension,
        };

        // Init array to hold parsed Serato markers
        let convertedMarkers: (CueEntry | ColorEntry | BPMLockEntry)[] = [];

        // Find song tag that Serato stores marker data in
        const rawID3Data = tags.native['ID3v2.4']?.find(tag => tag.id === 'GEOB' && tag.value.description === 'Serato Markers2')?.value.data
        
        // Decode and extract markers from ID3 GEOB Serato marker tag
        if (rawID3Data) {
            // Strip header leaving just the base64 string
            const headerStripped = rawID3Data.subarray(17).toString();
        
            // Strip newline characters (as Serato loves newlines characters in their base64)
            const newlinesStripped = headerStripped.replace(/\n/g, '');
        
            // Decode the base64 string revealing the actual marker data
            const base64Decoded = Buffer.from(newlinesStripped, 'base64');
        
            // Parse the marker data for the intermediary format
            convertedMarkers = parseSeratoMarkers(base64Decoded);
        }

        // Filter out all other markers apart from cues (as that is all we are interested in at this point)
        const onlyCueMarkers = convertedMarkers.filter((entry): entry is CueEntry => entry instanceof CueEntry);

        // Create intermediary format Track record
        return new Track(metadata, onlyCueMarkers);
    } finally {
        // Destroy read stream if anything goes wrong
        readStream.destroy();
    }
}

export async function convertTrack(filePath: string): Promise<Track> {
    const fileExtension = path.extname(filePath).toLowerCase();

    const absolutePath = path.resolve(filePath);

    const doesFileExist = fs.existsSync(absolutePath)
    const isSupportedFile = SUPPORTED_FILE_TYPES.includes(fileExtension);

    if (doesFileExist && isSupportedFile) {
        switch (fileExtension) {
            case '.flac':
                return await parseFlac(filePath);
            case '.mp3':
            case '.wav':
                return await parseMp3OrWav(filePath);
            default:
                break;
        }
    }

    throw 'File is not supported or does not exist';
}

export function convertTracks(filePaths: string[]): Promise<Track[]> {
    const convertPromises = filePaths
        // Only supports mp3, wav and flac so far
        .filter(filePath => {
            const isSupportedFile = SUPPORTED_FILE_TYPES.includes(path.extname(filePath).toLowerCase());
            return isSupportedFile;
        })
        .map(filePath => {
            return convertTrack(filePath);
        });
    
    // Wait for all tracks to resolve then build track map
    return Promise.all(convertPromises);
}
