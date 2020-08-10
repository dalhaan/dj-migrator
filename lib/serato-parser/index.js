const assert = require('assert');
const { parseAsPlaylist } = require('./crate-parser');
const { convertTrack } = require('./track-parser');

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

async function convertFromSerato(seratoDir, cratesToConvert) {
    // Get crates from '_Serato_/Subcrates' dir
    const subcrateDir = path.resolve(seratoDir, '_Serato_', 'Subcrates');

    // Assert that the subcrate directory exists
    const doesSubcrateDirExist = fs.existsSync(subcrateDir);
    assert(doesSubcrateDirExist, 'Could not find subcrates');

    let cratePaths = fs.readdirSync(subcrateDir);

    // Filter out non-crate files
    cratePaths = cratePaths.filter((cratePath) => {
        const isCrateFile = path.extname(cratePath) === '.crate';
        return isCrateFile;
    });
    
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

    return {
        playlists,
        trackMap,
    };
}

module.exports = { convertFromSerato };
