import * as fs from 'fs';
import * as path from 'path';
import { create as createXML } from 'xmlbuilder2';
import { ITrackMap, IProgressCallback, IPlaylist } from '../serato-parser';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';

interface IConvertToRekordboxParams {
    playlists: IPlaylist[],
    trackMap: ITrackMap,
    outputXMLPath: string,
    saveCuesAsMemoryCues?: boolean,
    saveCuesAsHotCues?: boolean,
    progressCallback: IProgressCallback
}

/**
 * Gets today's date in the format YYYY-MM-DD
 */
function getTodaysDate(): string {
    const date: Date = new Date();

    const day: string = date.getDay() < 10 ? `0${date.getDay()}` : `${date.getDay()}`;
    const month: string = date.getMonth() < 10 ? `0${date.getMonth()}` : `${date.getMonth()}`;

    return `${date.getFullYear()}-${month}-${day}`;
}

function buildCollectionTag(trackMap: ITrackMap, collectionXML: XMLBuilder, saveCuesAsMemoryCues: boolean, saveCuesAsHotCues: boolean, progressCallback: IProgressCallback = () => {}): XMLBuilder {
    const tracks = Object.keys(trackMap);

    collectionXML = collectionXML.ele('COLLECTION', { Entries: `${tracks.length}` });

    let i = 0;
    for (const track of tracks) {
        // Update progress callback
        const progress = (i / tracks.length) * 100;
        const progressMessage = `Building collection tags (track ${i + 1} of ${tracks.length})`;
        progressCallback(progress, progressMessage);

        const trackObject = trackMap[track];

        const bpm = trackObject.track.metadata.bpm && `${parseFloat(trackObject.track.metadata.bpm).toFixed(2)}`;
        const encodedLocation = trackObject.track.metadata.location
            .split(path.sep) // TODO: not sure this is necessary as Serato may always use forward slashes even on Windows
            .map(component => encodeURIComponent(component))
            .join('/');
        const location = `file://localhost${encodedLocation}`;
        const trackKey = `${trackObject.key}`;

        // Add the track to the collection
        collectionXML = collectionXML
        .ele('TRACK', {
            TrackID: trackKey, // This field only needs to match the playlist track keys as Rekordbox will auto-assign it
            Name: trackObject.track.metadata.title,
            Artist: trackObject.track.metadata.artist,
            Composer: '',
            Album: trackObject.track.metadata.album,
            Grouping: '',
            Genre: trackObject.track.metadata.genre?.[0],
            Kind: 'MP3 File',
            Size: `${trackObject.track.metadata.size}`,
            TotalTime: trackObject.track.metadata.duration && `${Math.ceil(trackObject.track.metadata.duration)}`, // TODO: this being '0' is preventing the cues from loading
            DiscNumber: '0',
            TrackNumber: '0',
            Year: '0',
            AverageBpm: bpm,
            DateAdded: getTodaysDate(),
            BitRate: trackObject.track.metadata.bitrate && `${trackObject.track.metadata.bitrate / 1000}`,
            SampleRate: `${trackObject.track.metadata.sampleRate}`,
            Comments: trackObject.track.metadata.comment?.[0],
            PlayCount: '0',
            Rating: '0',
            Location: location,
            Remixer: '',
            Tonality: trackObject.track.metadata.key,
            Label: '',
            Mix: '',
        });

        // Add the track's cue points as memory cues
        let iCuePoint = 0;
        for (const cuePoint of trackObject.track.cuePoints) {
            if (saveCuesAsMemoryCues) {
                collectionXML = collectionXML
                    .ele('POSITION_MARK', {
                        Name: '',
                        Type: '0',
                        Start: `${cuePoint.position / 1000}`,
                        Num: '-1'
                    }).up();
            }
            
            if (saveCuesAsHotCues) {
                collectionXML = collectionXML
                    .ele('POSITION_MARK', {
                        Name: '',
                        Type: '0',
                        Start: `${cuePoint.position / 1000}`,
                        Num: `${iCuePoint}`,
                        Red: '40',
                        Green: '226',
                        Blue: '20'
                    }).up();
                
                    iCuePoint++;
            }
        }

        collectionXML = collectionXML.up();
        i++;
    }

    progressCallback(100, 'Finished building collection tags');

    return collectionXML;
}

function buildPlaylistsTag(playlists: IPlaylist[], trackMap: ITrackMap, collectionXML: XMLBuilder, progressCallback: IProgressCallback = () => {}): XMLBuilder {
    collectionXML = collectionXML.up()
        .ele('PLAYLISTS')
            .ele('NODE', { Type: '0', Name: 'ROOT', Count: `${playlists.length}`});

    let i = 0;
    for (const playlist of playlists) {
        // Update progress callback
        const progress = (i / playlists.length) * 100;
        const progressMessage = `Building playlist tags (track ${i + 1} of ${playlists.length})`;
        progressCallback(progress, progressMessage);

        const filteredTracks = playlist.tracks.filter(track => trackMap[track]);

        collectionXML = collectionXML
            .ele('NODE', {
                Name: playlist.name,
                Type: '1',
                KeyType: '0',
                Entries: `${filteredTracks.length}`
            });

                    
        for (const track of filteredTracks) {
            const trackObject = trackMap[track];

            // Track may not be in track map if it does not exist or is not an mp3
            if (trackObject) {
                const trackKey = `${trackMap[track].key}`;

                collectionXML = collectionXML
                    .ele('TRACK', { Key: trackKey}).up();
            }
        }

        collectionXML = collectionXML.up();
        i++;
    }

    progressCallback(100, 'Finished building playlist tags');

    return collectionXML;
}

export function convertToRekordbox({
        playlists,
        trackMap,
        outputXMLPath,
        saveCuesAsMemoryCues = true,
        saveCuesAsHotCues = false,
        progressCallback = () => {},
    }: IConvertToRekordboxParams): Promise<void> {

    // Build RekordBox collection XML
    let collectionXML = createXML({ version: '1.0', encoding: 'UTF-8' })
        .ele('DJ_PLAYLISTS', { Version: '1.0.0' })
            .ele('PRODUCT', { Name: 'rekordbox', Version: '5.6.0', Company: 'Pioneer DJ' }).up()
            
    // Add tracks to RekordBox collection XML
    collectionXML = buildCollectionTag(trackMap, collectionXML, saveCuesAsMemoryCues, saveCuesAsHotCues, progressCallback);
    
    // Add playlists to RekordBox collection XML
    collectionXML = buildPlaylistsTag(playlists, trackMap, collectionXML, progressCallback);
    const xml = collectionXML.end({ prettyPrint: true })


    // Write collection XML to file
    fs.writeFileSync(outputXMLPath, xml);

    console.log(`RekordBox collection XML saved to: '${path.resolve(outputXMLPath)}'`);
    return Promise.resolve();
}
