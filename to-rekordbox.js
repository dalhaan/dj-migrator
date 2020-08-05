const fs = require('fs');
const path = require('path');
const { create: createXML } = require('xmlbuilder2');
const { parseAsPlaylist } = require('./crate-parser');
const { convertTrack } = require('./track-parser');



function createRekordBoxXML(tracks) {

}

async function buildTrackMap(rootDir, playlists) {
    const trackMap = {};

    for (const playlist of playlists) {
        console.log(playlist.tracks);
 
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

async function main(rootDir) {
    const CRATE_PATHS = [
        // './files/crates/D - All DnB.crate',
        // './files/crates/D - Commercial.crate',
        // './files/crates/D - Liquid.crate',
        // './files/crates/D - Old School.crate',
        // './files/crates/D - Neuro.crate',
        './files/crates/D - Minimal.crate',
    ];
    
    // TODO: to actually get crate paths from _Serato_/Subcrates folder relative to rootDir

    
    // Get playlists to convert
    const playlists = [];

    CRATE_PATHS.forEach((path) => {
        const playlist = parseAsPlaylist(path);

        playlists.push(playlist);
    });

    // Build track map for keeping track of tracks track track tra...
    const trackMap = await buildTrackMap(rootDir, playlists);

    console.log(trackMap);
}

main('/Volumes/DALLANS64');
