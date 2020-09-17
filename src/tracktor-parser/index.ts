import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as musicMetadata from 'music-metadata-browser';
import * as xml2js from 'xml2js';
import { readFile } from 'fs/promises';

import { IProgressCallback, ITrackMap, IPlaylist } from '../serato-parser';
import { IMetadata, Track } from '../serato-parser/track-parser';
import CuePoint from '../shared/CuePoint';

export const SUPPORTED_FILE_TYPES = ['.mp3', '.wav', '.flac'];

interface ConvertFromTracktor {
    playlistFilePath: string,
    progressCallback: IProgressCallback,
}

async function getMetadata(filePath: string) {
    const fileExtension = path.extname(filePath).toLowerCase();

    const absolutePath = path.resolve(filePath);

    const doesFileExist = fs.existsSync(absolutePath)
    const isSupportedFile = SUPPORTED_FILE_TYPES.includes(fileExtension);

    if (doesFileExist && isSupportedFile) {
        const fileExtension = path.extname(filePath).toLowerCase();
        
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
                key: fileExtension === '.flac' ? tags.native.vorbis?.find(tag => tag.id === 'INITIALKEY')?.value : tags.common?.key,
                sampleRate: tags.format?.sampleRate,
                bitrate: tags.format?.bitrate || 0,
                comment: tags.common?.comment,
                size: fileStats.size,
                duration: tags.format?.duration,
                location: filePath,
                fileExtension,
            };

           return metadata;
        } finally {
            // Destroy read stream if anything goes wrong
            readStream.destroy();
        }
    }

    throw 'File is not supported or does not exist';
}

function convertMarkers(entry: any): CuePoint[] {
    const cues = entry.CUE_V2;

    let convertedMarkers: CuePoint[] = [];

    for (const cue of cues) {
        if (cue.$.TYPE === '0') {
            const index = Number(cue.$.HOTCUE);
            const position = Number(cue.$.START);

            const convertedMarker = new CuePoint({
                index,
                position,
            });

            convertedMarkers = [
                ...convertedMarkers,
                convertedMarker,
            ];
        }
    }

    return convertedMarkers;
}

async function buildTrackMap(xml: any, progressCallback: IProgressCallback = () => {}) {
    const entries = xml.NML.COLLECTION[0].ENTRY;

    const trackMap: ITrackMap = {};

    let i = 0;
    for (const entry of entries) {
        const locationData = entry.LOCATION[0].$;
        const locationConstructed = `${locationData.VOLUME}${locationData.DIR}${locationData.FILE}`;

        const absolutePathContructed = `${locationData.VOLUME === 'Untitled' ? '' : `/Volumes/${locationData.VOLUME}`}${locationData.DIR}${locationData.FILE}`;
        const location = absolutePathContructed.replace(/\/:/g, '/');

        // Track must exist and be a supported type
        const doesFileExist = fs.existsSync(location);
        const isSupportedFile = SUPPORTED_FILE_TYPES.includes(path.extname(location).toLowerCase());

        if (doesFileExist && isSupportedFile) {
            // Update progress
            const progress = (i / entries.length) * 100;
            const message = `Processing track '${location}' (${i + 1} of ${entries.length})`
            progressCallback(progress, message);

            // Get metadata
            const metadata = await getMetadata(location);

            // Convert markers
            const cuePoints = convertMarkers(entry);

            // Create track object
            const track = new Track(metadata, cuePoints);

            trackMap[locationConstructed] = {
                key: Object.keys(trackMap).length + 1,
                absolutePath: location,
                track,
            }
        }

        i++;
    }

    return trackMap;
}

function parsePlaylists(xml: any, progressCallback: IProgressCallback = () => {}): IPlaylist[] {
    const rootNode = xml.NML.PLAYLISTS[0].NODE[0].SUBNODES[0].NODE;

    const playlists: IPlaylist[] = [];

    let i = 0;
    for (const playlistNode of rootNode) {
        // Update progress
        const progress = (i / rootNode.length) * 100;
        const message = `Processing playlist '${playlistNode.$.NAME}' (${i + 1} of ${rootNode.length})`
        progressCallback(progress, message);

        const tracks = playlistNode.PLAYLIST[0].ENTRY.map((entry: any) => entry.PRIMARYKEY[0].$.KEY);

        const playlist = {
            name: playlistNode.$.NAME,
            tracks,
        };

        playlists.push(playlist);
        i++;
    }

    return playlists;
}

export async function convertFromTracktor({ playlistFilePath, progressCallback = () => {} }: ConvertFromTracktor): Promise<any> {
    const data = await readFile(playlistFilePath);
    const xml = await xml2js.parseStringPromise(data);

    const playlists = parsePlaylists(xml, progressCallback);
    const trackMap = await buildTrackMap(xml, progressCallback);

    return {
        playlists,
        trackMap,
    };
}
