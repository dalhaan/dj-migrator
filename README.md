# serato-to-rekordbox

## prologue

This project started because I have been a Serato user for years, over the time adding new tracks to my library, setting exact cue points and organising them into genre/mood specific crates, to where now I have hundreds of carefully analysed tracks. I am now faced with the issue of performing on Pioneer CDJs, which run RekordBox software. The problem being that these software are not compatible with one another and have very different ways of storing track metadata and playlists.

I began looking for software that can convert tracks and playlists from one to the other. To my surprise there were very little resources on this topic and only one or two (paid) options out there. This was very surprising as both Serato and Rekordbox dominate the DJ software market, with many many many DJs having this same issue of migrating. Most succumbing to painstakingly rebuilding their entire library in the other software (tens of hours of effort).

The two library migration software that exist both cost around $75NZD and me (being a cheapskate) decided I would just make this software myself.

## design

My goal for this project was to create an intermediary track and playlist format that I can convert to and from. This way I can cut down on the amount of conversions I need to create. If I were to convert each format to another directly, the more formats I want to support, the amount of extra conversions I need to make increases expontentially. Where if I only have to convert each format to the intermediary format and back, the amount of extra conversions I need to make increases linearly.

If I were to migrate to each directly: n * (n-1)

![alt text](https://chart.googleapis.com/chart?cht=gv&chl=digraph{subgraph{SeratoA;RekordBoxA;VDJA;TracktorA}subgraph{SeratoB;RekordBoxB;VDJB;TracktorB}SeratoA->{RekordBoxB;VDJB;TracktorB}RekordBoxA->{SeratoB;VDJB;TracktorB}VDJA->{SeratoB;RekordBoxB;TracktorB}TracktorA->{RekordBoxB;VDJB;SeratoB}})

If I were to migrate to an intermediary format: n * 2

![alt text](https://chart.googleapis.com/chart?cht=gv&chl=digraph{subgraph{label=%22From%22;SeratoA;RekordBoxA;VDJA;TracktorA}Intermediary;subgraph{SeratoB;RekordBoxB;VDJB;TracktorB}{SeratoA;VDJA;TracktorA;RekordBoxA}-%3EIntermediary;Intermediary-%3E{SeratoB;RekordBoxB;TracktorB;VDJB}}})
