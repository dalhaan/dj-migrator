const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { parseAsPlaylist } = require('./crate-parser');
const { convertTrack } = require('./track-parser');

async function buildTrackMap(rootDir, playlists, progressCallback = () => {}) {
    const trackMap = {};

    let iPlaylist = 0;

    for (const playlist of playlists) {
        let iTrack = 0;

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

                    // Update progress callback
                    const progress = (iPlaylist / playlists.length) * 100;
                    const message = `Converting crate '${playlist.name}' (track ${iTrack + 1} of ${playlist.tracks.length})`;
                    progressCallback(progress, message);
                }
            }

            iTrack++;
        }

        iPlaylist++;
        };

        progressCallback(100, 'Finished converting crates');

     return trackMap;
}

async function convertFromSerato(seratoDir, cratesToConvert, progressCallback = () => {}) {
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

    cratePaths.forEach((path, i) => {
        const playlist = parseAsPlaylist(path);

        playlists.push(playlist);

        // Update progress callback
        const percentage = (i / cratePaths.length) * 100;
        const message = `Analysing crate '${playlist.name}' (${i + 1} of ${cratePaths.length})`;
        progressCallback(percentage, message);
    });

    progressCallback(100, 'Finished analysing crates');

    // Build track map for keeping track of tracks track track tra...
    const trackMap = await buildTrackMap(seratoDir, playlists, progressCallback);

    return {
        playlists,
        trackMap,
    };
}

module.exports = { convertFromSerato };
