const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { create: createXML } = require('xmlbuilder2');
const { parseAsPlaylist } = require('./crate-parser');
const { convertTrack } = require('./track-parser');

/**
 * Gets today's date in the format YYYY-MM-DD
 */
function getTodaysDate() {
    const date = new Date();

    const day = date.getDay() < 10 ? `0${date.getDay()}` : date.getDay();
    const month = date.getMonth() < 10 ? `0${date.getMonth()}` : date.getMonth();

    return `${date.getFullYear()}-${month}-${day}`;
}

async function buildTrackMap(rootDir, playlists) {
    const trackMap = {};

    for (const playlist of playlists) {
         for (const track of playlist.tracks) {
             // Only add track if it hasn't already been added
             if (!trackMap[track]) {
                 // Get absolute path as it seems Serato uses relative paths for crates on USBs
                 const absolutePath = path.resolve(rootDir, track);
 
                 // Track must exist and be an MP3 as those are the only files we can get cues from so far
                 const doesFileExist = fs.existsSync(absolutePath);
                 const isMP3 = path.extname(absolutePath).toLowerCase() === '.mp3';
 
                 // Add track to the track map
                 if (doesFileExist && isMP3) {
                     const trackObject = await convertTrack(absolutePath);
 
                     trackMap[track] = {
                         key: Object.keys(trackMap).length + 1,
                         absolutePath, // TODO: Don't think we are using this field
                         track: trackObject,
                     };
                 }
             }
         }
     };

     return trackMap;
}

function buildCollectionTag(trackMap, collectionXML) {
    const tracks = Object.keys(trackMap);

    collectionXML = collectionXML.ele('COLLECTION', { Entries: `${tracks.length}` });

    for (const track of tracks) {
        const trackObject = trackMap[track];

        const bpm = `${parseFloat(trackObject.track.metadata.bpm).toFixed(2)}`;
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
            TotalTime: `${parseInt(trackObject.track.metadata.duration)}`, // TODO: this being '0' is preventing the cues from loading
            DiscNumber: '0',
            TrackNumber: '0',
            Year: '0',
            AverageBpm: bpm,
            DateAdded: getTodaysDate(),
            BitRate: `${trackObject.track.metadata.bitrate / 1000}`,
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
        for (cuePoint of trackObject.track.cuePoints) {
            collectionXML = collectionXML
                .ele('POSITION_MARK', {
                    Name: '',
                    Type: '0',
                    Start: `${cuePoint.position / 1000}`,
                    Num: '-1'
                }).up();
        }

        collectionXML = collectionXML.up();
    }

    return collectionXML;
}

function buildPlaylistsTag(playlists, trackMap, collectionXML) {
    collectionXML = collectionXML.up()
        .ele('PLAYLISTS')
            .ele('NODE', { Type: '0', Name: 'ROOT', Count: `${playlists.length}`});

    for (const playlist of playlists) {
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
    }

    return collectionXML;
}

async function convertSeratoToRekordBox(seratoDir, outputXMLPath, cratesToConvert) {
    // Get crates from '_Serato_/Subcrates' dir
    const subcrateDir = path.resolve(seratoDir, '_Serato_', 'Subcrates');

    // Assert that the subcrate directory exists
    const doesSubcrateDirExist = fs.existsSync(subcrateDir);
    assert(doesSubcrateDirExist, 'Could not find subcrates');

    let cratePaths = fs.readdirSync(subcrateDir);
    
    // If a list of crates have been specified, filter out crates that don't apply
    if (cratesToConvert) {
        cratePaths = cratePaths.filter(cratePath => cratesToConvert.includes(path.basename(cratePath, '.crate')));
    }
    
    // Get proper path to crates
    cratePaths = cratePaths.map(cratePath => path.join(subcrateDir, cratePath));
    
    // Get playlists to convert
    const playlists = [];

    cratePaths.forEach((path) => {
        const playlist = parseAsPlaylist(path);

        playlists.push(playlist);
    });

    // Build track map for keeping track of tracks track track tra...
    const trackMap = await buildTrackMap(seratoDir, playlists);

    // Build RekordBox collection XML
    let collectionXML = createXML({ version: '1.0', encoding: 'UTF-8' })
        .ele('DJ_PLAYLISTS', { Version: '1.0.0' })
            .ele('PRODUCT', { Name: 'rekordbox', Version: '5.6.0', Company: 'Pioneer DJ' }).up()
            
    // Add tracks to RekordBox collection XML
    collectionXML = buildCollectionTag(trackMap, collectionXML);
    
    // Add playlists to RekordBox collection XML
    collectionXML = buildPlaylistsTag(playlists, trackMap, collectionXML);
    const xml = collectionXML.end({ prettyPrint: true })


    // Write collection XML to file
    fs.writeFileSync(outputXMLPath, xml);

    console.log(`RekordBox collection XML saved to: '${path.resolve(outputXMLPath)}'`);
}

module.exports = { convertSeratoToRekordBox };
