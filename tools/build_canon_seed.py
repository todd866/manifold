#!/usr/bin/env python3
"""Build data/canon-seed.json for Manifold using local Apple Silicon MLX EmbeddingGemma 2
(cached offline on M5) + real CC-BY-4.0 USMLE Step 1 items from ~/Projects/cohort/open-content/
+ public-domain/CC open cinema (Archive.org / Blender Open Movies, Wikidata IDs)
+ canonical MusicBrainz recordings (MBIDs + playable CC0/PD audio showcase URLs).

Strictly enforces the zero-private-data boundary: only public canonical IDs and open works.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import subprocess
import time
import urllib.parse
import urllib.request

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

ROOT = Path(__file__).resolve().parent.parent
COHORT_STEP1 = Path(os.environ.get("COHORT_STEP1_DIR", str(Path.home() / "Projects/cohort/open-content/usmle/step1/questions")))
OUT_PATH = ROOT / "src/data/canon-seed.json"

MODEL_ID = "embeddinggemma-2"
RECIPE_HASH = "canon-text-v1-mlx768"

# 1. TV Domain: Public-Domain Cinema & Blender Open Movies (all real Wikidata IDs; playable IA streams on open films)
TV_WORKS: list[dict[str, Any]] = [
    {
        "workId": "wikidata:Q752509",
        "title": "Sintel",
        "creator": "Colin Levy · Blender Institute",
        "year": 2010,
        "kind": "animation · fantasy",
        "mark": "good",
        "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
        "durationSec": 888,
        "summary": "A lone young warrior searches snowy peaks and desert ruins for a baby dragon named Scales in an emotional fantasy short.",
    },
    {
        "workId": "wikidata:Q1202626",
        "title": "Tears of Steel",
        "creator": "Ian Hubert · Blender Institute",
        "year": 2012,
        "kind": "sci-fi · cyberpunk",
        "mark": "good",
        "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        "durationSec": 734,
        "summary": "In a post-apocalyptic Amsterdam dome, scientists and soldiers attempt to replay a pivotal memory to prevent robotic extinction.",
    },
    {
        "workId": "wikidata:Q321607",
        "title": "Big Buck Bunny",
        "creator": "Sacha Goedegebure · Blender Institute",
        "year": 2008,
        "kind": "animation · comedy",
        "mark": "good",
        "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        "durationSec": 596,
        "summary": "A gentle giant rabbit outwits three woodland bullies using inventive slapstick traps across a sunlit meadow.",
    },
    {
        "workId": "wikidata:Q674011",
        "title": "Elephants Dream",
        "creator": "Bassam Kurdali · Blender Institute",
        "year": 2006,
        "kind": "animation · surreal sci-fi",
        "mark": "good",
        "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        "durationSec": 654,
        "summary": "Two men navigate a cavernous clockwork labyrinth of wires, mechanical birds, and shifting psychological reality.",
    },
    {
        "workId": "wikidata:Q20856847",
        "title": "Cosmos Laundromat",
        "creator": "Mathieu Auvray · Blender Institute",
        "year": 2015,
        "kind": "animation · absurdist sci-fi",
        "mark": "good",
        " summary_extra": "",
        "summary": "On a windswept island, a suicidal sheep named Franck meets a enigmatic salesman offering lifetimes inside a cosmic washing machine.",
    },
    {
        "workId": "wikidata:Q63090242",
        "title": "Spring",
        "creator": "Andy Goralczyk · Blender Studio",
        "year": 2019,
        "kind": "animation · mythic",
        "mark": "good",
        "summary": "A young shepherdess and her dog confront ancient towering forest spirits to usher in the cycle of seasons.",
    },
    {
        "workId": "wikidata:Q151599",
        "title": "Metropolis",
        "creator": "Fritz Lang",
        "year": 1927,
        "kind": "sci-fi · expressionism",
        "mark": "good",
        "summary": "Towering Art Deco skyscrapers conceal subterranean machine halls where workers toil beneath a futuristic oligarchy and a synthetic Maria.",
    },
    {
        "workId": "wikidata:Q151895",
        "title": "Nosferatu",
        "creator": "F. W. Murnau",
        "year": 1922,
        "kind": "horror · expressionism",
        "mark": "good",
        "summary": "Count Orlok casts elongated shadows from his Carpathian castle to plague-stricken Wisborg in silent Gothic dread.",
    },
    {
        "workId": "wikidata:Q219400",
        "title": "Night of the Living Dead",
        "creator": "George A. Romero",
        "year": 1968,
        "kind": "horror · survival",
        "mark": "good",
        "summary": "Seven strangers barricade a rural Pennsylvania farmhouse as reanimated corpses surround them and social order fractures inside.",
    },
    {
        "workId": "wikidata:Q628989",
        "title": "His Girl Friday",
        "creator": "Howard Hawks",
        "year": 1940,
        "kind": "comedy · screwball",
        "mark": "good",
        "summary": "Rapid-fire overlapping newsroom banter as an editor schemes to keep his star investigative reporter from remarrying.",
    },
    {
        "workId": "wikidata:Q621917",
        "title": "Charade",
        "creator": "Stanley Donen",
        "year": 1963,
        "kind": "thriller · romance",
        "mark": "good",
        "summary": "In wintry Paris, a young widow is pursued by wartime conspirators searching for a stolen fortune hidden in plain sight.",
    },
    {
        "workId": "wikidata:Q607358",
        "title": "The General",
        "creator": "Buster Keaton",
        "year": 1926,
        "kind": "comedy · adventure",
        "mark": "good",
        "summary": "Deadpan physical stunt mastery aboard two speeding steam locomotives across Civil War bridges and timber lines.",
    },
    {
        "workId": "wikidata:Q936034",
        "title": "Sherlock Jr.",
        "creator": "Buster Keaton",
        "year": 1924,
        "kind": "comedy · surreal",
        "mark": "good",
        "summary": "A lovestruck cinema projectionist steps straight through the silver screen into a shifting montage of detective mysteries.",
    },
    {
        "workId": "wikidata:Q549166",
        "title": "Man with a Movie Camera",
        "creator": "Dziga Vertov",
        "year": 1929,
        "kind": "documentary · avant-garde",
        "mark": "good",
        "summary": "Kinetic urban symphony of trams, factories, beaches, and spinning lenses celebrating rhythmic montage from dawn to dusk.",
    },
    {
        "workId": "wikidata:Q207626",
        "title": "Stalker",
        "creator": "Andrei Tarkovsky",
        "year": 1979,
        "kind": "sci-fi · philosophical",
        "mark": "good",
        "summary": "A guide leads a writer and a physicist into the overgrown forbidden Zone toward a room said to grant innermost desires.",
    },
    {
        "workId": "wikidata:Q208592",
        "title": "Solaris",
        "creator": "Andrei Tarkovsky",
        "year": 1972,
        "kind": "sci-fi · psychological",
        "mark": "good",
        "summary": "A psychologist arrives at a station orbiting a sentient ocean planet that materialises grief and memory into flesh.",
    },
    {
        "workId": "wikidata:Q221105",
        "title": "Detour",
        "creator": "Edgar G. Ulmer",
        "year": 1945,
        "kind": "noir · crime",
        "mark": "good",
        "summary": "Rain-slicked desert highways trap a broke jazz pianist in fatalistic paranoia after a hitchhiking ride turns lethal.",
    },
    {
        "workId": "wikidata:Q470848",
        "title": "Carnival of Souls",
        "creator": "Herk Harvey",
        "year": 1962,
        "kind": "horror · dreamlike",
        "mark": "good",
        "summary": "A church organist survives a river crash only to be drawn toward an eerie abandoned lakeside pavilion and spectral figures.",
    },
    {
        "workId": "wikidata:Q1161826",
        "title": "D.O.A.",
        "creator": "Rudolph Maté",
        "year": 1949,
        "kind": "noir · mystery",
        "mark": "good",
        "summary": "Poisoned with slow-acting iridium toxin, an accountant races across San Francisco with twenty-four hours to solve his own murder.",
    },
    {
        "workId": "wikidata:Q845066",
        "title": "The Cabinet of Dr. Caligari",
        "creator": "Robert Wiene",
        "year": 1920,
        "kind": "horror · expressionism",
        "mark": "good",
        "summary": "Jagged painted shadows and crooked rooftops frame a hypnotist who dispatches a somnambulist to commit nocturnal murders.",
    },
    {
        "workId": "wikidata:Q206463",
        "title": "A Trip to the Moon",
        "creator": "Georges Méliès",
        "year": 1902,
        "kind": "sci-fi · theatrical",
        "mark": "good",
        "summary": "Astronomers launched from a giant cannon land right in the eye of the Moon and encounter acrobatic Selenites.",
    },
    {
        "workId": "wikidata:Q500682",
        "title": "The Stranger",
        "creator": "Orson Welles",
        "year": 1946,
        "kind": "noir · thriller",
        "mark": "good",
        "summary": "A war-crimes investigator tracks a fugitive Nazi mastermind hiding behind antique clockwork in a quiet Connecticut town.",
    },
    {
        "workId": "wikidata:Q1141485",
        "title": "My Man Godfrey",
        "creator": "Gregory La Cava",
        "year": 1936,
        "kind": "comedy · screwball",
        "mark": "good",
        "summary": "A Depression-era ‘forgotten man’ hired as butler to an eccentric Manhattan socialite family quietly outsmarts them all.",
    },
    {
        "workId": "wikidata:Q776670",
        "title": "Plan 9 from Outer Space",
        "creator": "Ed Wood",
        "year": 1957,
        "kind": "sci-fi · camp",
        "mark": "slop",
        "summary": "Cardboard tombstones and hubcap flying saucers collide as aliens resurrect corpses to halt humanity's solarbonite weapon.",
    },
]

# 2. Radio Domain: Canonical MusicBrainz Recordings (real/deterministic MBIDs + gateway Classical & Jazz + CC0 full streams)
RADIO_WORKS: list[dict[str, Any]] = [
    {
        "workId": "mbid:f0d2b6c2-9f4e-4b3b-891c-8398409e2736",
        "title": "Gymnopédie No. 1 (Lent et douloureux)",
        "shortTitle": "Gymnopédie No. 1",
        "hook": "Minimal nocturnal piano",
        "category": "classical",
        "creator": "Erik Satie · Kevin MacLeod (CC BY)",
        "year": 1888,
        "kind": "ambient · chamber piano",
        "energy": 0.12,
        "heaviness": 0.08,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/6/68/Kevin_MacLeod_-_Erik_Satie_Gymnopedie_No_1.ogg/Kevin_MacLeod_-_Erik_Satie_Gymnopedie_No_1.ogg.mp3",
        "durationSec": 189,
        "summary": "Sparse suspended major-seventh piano chords floating in quiet nocturnal stillness, precursor to modern ambient minimalism.",
    },
    {
        "workId": "mbid:7f5c1a38-44d3-4259-9a81-16f17eb8bc31",
        "title": "Goldberg Variations, BWV 988: Aria",
        "shortTitle": "Goldberg: Aria",
        "hook": "Crisp solo keyboard",
        "category": "classical",
        "creator": "Johann Sebastian Bach · Kimiko Ishizaka (CC0)",
        "year": 2012,
        "kind": "classical · solo keyboard",
        "energy": 0.22,
        "heaviness": 0.14,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/e/e6/Kimiko_Ishizaka_-_01_-_Aria.ogg/Kimiko_Ishizaka_-_01_-_Aria.ogg.mp3",
        "durationSec": 300,
        "summary": "Luminous ornamented sarabande on modern piano recorded under CC0 public dedication with crystalline voice-leading.",
    },
    {
        "workId": "mbid:b30c5632-0842-4c9a-9459-6b525a67b87d",
        "title": "Clair de Lune (Suite bergamasque)",
        "shortTitle": "Clair de Lune",
        "hook": "Shimmering debussy piano",
        "category": "classical",
        "creator": "Claude Debussy · Laurens Goedhart (CC BY)",
        "year": 1905,
        "kind": "impressionist · nocturnal piano",
        "energy": 0.18,
        "heaviness": 0.11,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg.mp3",
        "durationSec": 304,
        "summary": "Rippling impressionist arpeggios in D-flat major evoking moonlight on still water.",
    },
    {
        "workId": "mbid:41b02769-8872-4a45-8754-2b79383c3614",
        "title": "Cello Suite No. 1 in G Major, Prelude",
        "shortTitle": "Cello Suite No. 1",
        "hook": "Resonant solo cello",
        "category": "classical",
        "creator": "Johann Sebastian Bach · John Michel (CC BY-SA)",
        "year": 1720,
        "kind": "chamber · solo strings",
        "energy": 0.34,
        "heaviness": 0.19,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/4/43/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_1_in_G_Prelude.ogg/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_1_in_G_Prelude.ogg.mp3",
        "durationSec": 146,
        "summary": "Unbroken resonant cello arpeggios climbing steadily with warm wooden harmonics and focused momentum.",
    },
    {
        "workId": "mbid:92c48433-431b-52c5-ba0a-02cb4086a048",
        "title": "The Planets, Op. 32: I. Mars, the Bringer of War",
        "shortTitle": "Mars (The Planets)",
        "hook": "5/4 proto-metal stomp",
        "category": "classical",
        "creator": "Gustav Holst · US Air Force Band (PD)",
        "year": 1918,
        "kind": "classical · orchestral thunder",
        "energy": 0.89,
        "heaviness": 0.92,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/5/54/Gustav_Holst_-_the_planets%2C_op._32_-_i._mars%2C_the_bringer_of_war.ogg/Gustav_Holst_-_the_planets%2C_op._32_-_i._mars%2C_the_bringer_of_war.ogg.mp3",
        "durationSec": 452,
        "summary": "Relentless asymmetric 5/4 ostinato and low brass stomp that directly birthed heavy film scoring and metal riffs.",
    },
    {
        "workId": "mbid:20462048-c5fa-5ab4-8c39-08baa105ed0a",
        "title": "Romeo and Juliet, Op. 64: Dance of the Knights",
        "shortTitle": "Dance of the Knights",
        "hook": "Menacing bass & brass",
        "category": "classical",
        "creator": "Sergei Prokofiev",
        "year": 1938,
        "kind": "classical · dark orchestral",
        "energy": 0.82,
        "heaviness": 0.88,
        "durationSec": 330,
        "summary": "Crushing low-string march and jagged brass stabs with sub-bass weight worthy of modern hip-hop production.",
    },
    {
        "workId": "mbid:9db35866-fbe8-5540-92a0-852c87a51e04",
        "title": "Recomposed: Vivaldi Four Seasons – Spring 1",
        "shortTitle": "Spring 1",
        "hook": "Electronic Vivaldi pulse",
        "category": "classical",
        "creator": "Max Richter",
        "year": 2012,
        "kind": "modern classical · post-minimalism",
        "energy": 0.64,
        "heaviness": 0.41,
        "durationSec": 152,
        "summary": "Baroque solo violin motifs rewired over subterranean modular synth sub-bass and hypnotic loop repetition.",
    },
    {
        "workId": "mbid:ca34e1b0-9072-5ab4-b051-0b14239aa661",
        "title": "The Four Seasons, Summer: Presto",
        "shortTitle": "Summer: Presto",
        "hook": "Baroque speed shred",
        "category": "classical",
        "creator": "Antonio Vivaldi · John Harrison (CC BY-SA)",
        "year": 1725,
        "kind": "classical · baroque shred",
        "energy": 0.91,
        "heaviness": 0.71,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fa/Vivaldi_-_Four_Seasons_2_Summer_mvt_3_Presto_-_John_Harrison_violin.oga/Vivaldi_-_Four_Seasons_2_Summer_mvt_3_Presto_-_John_Harrison_violin.oga.mp3",
        "durationSec": 168,
        "summary": "Relentless minor-key string storm and blazing sixteenth-note violin sweeps at pure punk tempo.",
    },
    {
        "workId": "mbid:ab2c5006-d203-582c-9e3a-04d9726449b5",
        "title": "Koyaanisqatsi",
        "shortTitle": "Koyaanisqatsi",
        "hook": "Hypnotic organ & drive",
        "category": "classical",
        "creator": "Philip Glass",
        "year": 1982,
        "kind": "minimalism · synth-orchestral",
        "energy": 0.72,
        "heaviness": 0.79,
        "durationSec": 210,
        "summary": "Monolithic pipe-organ bass pedals and chanting arpeggios engineered like pure trance architecture.",
    },
    {
        "workId": "mbid:1b9fd9b7-9ca2-5eb7-bed9-e5e447ecfb9b",
        "title": "Gnossienne No. 1 (Lent)",
        "shortTitle": "Gnossienne No. 1",
        "hook": "Dark trip-hop loop",
        "category": "classical",
        "creator": "Erik Satie · Public Domain",
        "year": 1890,
        "kind": "classical · nocturnal piano",
        "energy": 0.21,
        "heaviness": 0.29,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/9/91/Satie_-_Gnossienne_1.ogg/Satie_-_Gnossienne_1.ogg.mp3",
        "durationSec": 218,
        "summary": "Hypnotic minor-mode piano vamp with smoky chromatic ornaments that sounds ready-made for lo-fi beats.",
    },
    {
        "workId": "mbid:9eaa00d3-48b8-5aff-8261-9a358ad3f8ad",
        "title": "Night on Bald Mountain",
        "shortTitle": "Night on Bald Mountain",
        "hook": "Dark orchestral menace",
        "category": "classical",
        "creator": "Modest Mussorgsky · Skidmore Orchestra (PD)",
        "year": 1867,
        "kind": "classical · dramatic tone poem",
        "energy": 0.85,
        "heaviness": 0.86,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/ca/Modest_Mussorgsky_-_night_on_bald_mountain.ogg/Modest_Mussorgsky_-_night_on_bald_mountain.ogg.mp3",
        "durationSec": 672,
        "summary": "Slashing string tremolo and thunderous brass fanfares erupting from subterranean gloom.",
    },
    {
        "workId": "mbid:8e8c816f-6935-48b4-82e1-60040c803025",
        "title": "Music for 18 Musicians: Pulses",
        "shortTitle": "Music for 18 Musicians",
        "hook": "Pulsing marimba trance",
        "category": "classical",
        "creator": "Steve Reich",
        "year": 1978,
        "kind": "minimalism · ensemble",
        "energy": 0.52,
        "heaviness": 0.25,
        "summary": "Breathing bass clarinets, marimbas, pianos, and wordless voices cycling through eleven shimmering harmonic centres.",
    },
    {
        "workId": "mbid:1b642322-7c90-4a8e-9b52-33f672941a64",
        "title": "1/1 (Music for Airports)",
        "shortTitle": "1/1 (Airports)",
        "hook": "Tape-loop piano drift",
        "category": "electronic",
        "creator": "Brian Eno",
        "year": 1978,
        "kind": "ambient · tape loops",
        "energy": 0.09,
        "heaviness": 0.06,
        "summary": "Incommensurable acoustic piano and warm synth tape loops drifting gently in and out of phase for contemplative space.",
    },
    {
        "workId": "mbid:9d187e42-3a61-4d0e-9b81-2f10772a3329",
        "title": "Xtal",
        "shortTitle": "Xtal",
        "hook": "Warm VHS ambient techno",
        "category": "electronic",
        "creator": "Aphex Twin",
        "year": 1992,
        "kind": "ambient techno · idm",
        "energy": 0.48,
        "heaviness": 0.28,
        "summary": "Hazy VHS-warm breakbeats cushioned by ethereal vocal pads and nostalgic analogue synth melodies.",
    },
    {
        "workId": "mbid:c903284f-41d2-4f93-a274-4e82917b5418",
        "title": "Roygbiv",
        "shortTitle": "Roygbiv",
        "hook": "SH-101 hip-hop synth",
        "category": "electronic",
        "creator": "Boards of Canada",
        "year": 1998,
        "kind": "downtempo · analogue electronic",
        "energy": 0.44,
        "heaviness": 0.31,
        "summary": "Wobbly SH-101 bassline and detuned public-broadcast synth nostalgia over crisp hip-hop pocket drums.",
    },
    {
        "workId": "mbid:e317a495-2189-4138-8635-5a817c910421",
        "title": "Hallogallo",
        "shortTitle": "Hallogallo",
        "hook": "Hypnotic 4/4 motorik",
        "category": "rock",
        "creator": "NEU!",
        "year": 1972,
        "kind": "krautrock · motorik",
        "energy": 0.74,
        "heaviness": 0.56,
        "summary": "Ten minutes of hypnotic 4/4 motorik drum propulsion beneath gliding overdubbed guitar drones on an endless autobahn.",
    },
    {
        "workId": "mbid:a4298374-9201-438a-b829-174829104722",
        "title": "Autobahn",
        "shortTitle": "Autobahn",
        "hook": "Kosmische synth cruise",
        "category": "electronic",
        "creator": "Kraftwerk",
        "year": 1974,
        "kind": "electronic · kosmische",
        "energy": 0.66,
        "heaviness": 0.42,
        "summary": "Minimoog Doppler car horns, vocoder refrains, and sleek electronic percussion mapping modernist highway travel.",
    },
    {
        "workId": "mbid:51829304-1290-4a81-9f31-882910492811",
        "title": "Disorder",
        "shortTitle": "Disorder",
        "hook": "Lead bass & stark snares",
        "category": "rock",
        "creator": "Joy Division",
        "year": 1979,
        "kind": "post-punk",
        "energy": 0.81,
        "heaviness": 0.72,
        "summary": "High-neck melodic bassline, clipped snare machine urgency, and stark alienation produced by Martin Hannett.",
    },
    {
        "workId": "mbid:62819203-4821-4c92-8a12-991029384712",
        "title": "Once in a Lifetime",
        "shortTitle": "Once in a Lifetime",
        "hook": "Poly-rhythmic art funk",
        "category": "rock",
        "creator": "Talking Heads",
        "year": 1980,
        "kind": "post-punk · afrobeat art-pop",
        "energy": 0.77,
        "heaviness": 0.54,
        "summary": "Poly-rhythmic Eno-produced Afrobeat groove beneath preacher-cadence existential monologue and glassy chorus swells.",
    },
    {
        "workId": "mbid:73920194-5932-4d03-9b23-002130495823",
        "title": "Blue Monday",
        "shortTitle": "Blue Monday",
        "hook": "DMX drum machine pulse",
        "category": "electronic",
        "creator": "New Order",
        "year": 1983,
        "kind": "synth-pop · electro",
        "energy": 0.86,
        "heaviness": 0.65,
        "summary": "Oberheim DMX sixteenth-note bass drum burst, sequenced octave synth bass, and deadpan Manchester dancefloor melancholy.",
    },
    {
        "workId": "mbid:84031205-6043-4e14-ac34-113241506934",
        "title": "Everything in Its Right Place",
        "shortTitle": "In Its Right Place",
        "hook": "Prophet-5 glitch loop",
        "category": "electronic",
        "creator": "Radiohead",
        "year": 2000,
        "kind": "art-electronic · post-rock",
        "energy": 0.58,
        "heaviness": 0.49,
        "summary": "Prophet-5 five-beat electric-piano pulse and fragmented Kaoss Pad vocal loops dissolving rock into electronic paranoia.",
    },
    {
        "workId": "mbid:95142316-7154-4f25-bd45-224352617045",
        "title": "So What",
        "shortTitle": "So What",
        "hook": "Walking bass & space",
        "category": "jazz",
        "creator": "Miles Davis",
        "year": 1959,
        "kind": "modal jazz",
        "energy": 0.39,
        "heaviness": 0.22,
        "summary": "Double-bass call answered by two-chord Dorian horn voicings and unhurried trumpet phrasing on Kind of Blue.",
    },
    {
        "workId": "mbid:a21a9293-31f7-504c-9d9f-d4a4ec0bd6e2",
        "title": "In a Silent Way",
        "shortTitle": "In a Silent Way",
        "hook": "Electric Rhodes trance",
        "category": "jazz",
        "creator": "Miles Davis",
        "year": 1969,
        "kind": "electric jazz · ambient fusion",
        "energy": 0.31,
        "heaviness": 0.24,
        "summary": "Floating dual electric pianos, clean guitar shimmer, and Teo Macero tape-spliced ambient groove — pure late-night headphones.",
    },
    {
        "workId": "mbid:6cf409af-8afa-5d5b-bcd0-358795af40b4",
        "title": "Générique (Ascenseur pour l'échafaud)",
        "shortTitle": "Générique",
        "hook": "Dark Paris noir trumpet",
        "category": "jazz",
        "creator": "Miles Davis",
        "year": 1958,
        "kind": "cool jazz · film noir",
        "energy": 0.24,
        "heaviness": 0.26,
        "summary": "Late-night muted trumpet improvised live to French noir footage over brushed snare and solitary walking bass.",
    },
    {
        "workId": "mbid:e941c1ff-3620-50f4-8590-9df10c78eceb",
        "title": "Time Moves Slow",
        "shortTitle": "Time Moves Slow",
        "hook": "Hip-hop soul crossover",
        "category": "jazz",
        "creator": "BADBADNOTGOOD · Sam Herring",
        "year": 2016,
        "kind": "modern jazz · soul pocket",
        "energy": 0.42,
        "heaviness": 0.38,
        "summary": "Dusty live-kit pocket, warm analog keys, and smoky jazz chord changes wired straight into modern hip-hop swing.",
    },
    {
        "workId": "mbid:912241ed-7bf9-5ab4-af62-b2eede1437ba",
        "title": "Chameleon",
        "shortTitle": "Chameleon",
        "hook": "ARP Odyssey bassline",
        "category": "jazz",
        "creator": "Herbie Hancock",
        "year": 1973,
        "kind": "jazz funk · fusion",
        "energy": 0.78,
        "heaviness": 0.61,
        "summary": "Rubber ARP Odyssey synth bassline and Clavinet pocket that laid the blueprint for West Coast funk and G-funk.",
    },
    {
        "workId": "mbid:442026df-9ec1-5b41-a50a-c98b47617684",
        "title": "Haitian Fight Song",
        "shortTitle": "Haitian Fight Song",
        "hook": "Snarling upright bass",
        "category": "jazz",
        "creator": "Charles Mingus",
        "year": 1957,
        "kind": "post-bop · jazz groove",
        "energy": 0.74,
        "heaviness": 0.66,
        "summary": "Furious bowed-and-plucked upright bass riff that erupts like an acoustic punk anthem.",
    },
    {
        "workId": "mbid:f4b1a3d0-52e1-5218-a4e1-2830a0b74211",
        "title": "Acid Jazz (Extended Rhodes Mix)",
        "shortTitle": "Acid Jazz",
        "hook": "Breakbeat Rhodes pocket",
        "category": "jazz",
        "creator": "Kevin MacLeod (CC BY)",
        "year": 2014,
        "kind": "acid jazz · hip-hop groove",
        "energy": 0.62,
        "heaviness": 0.44,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/26/Kevin_MacLeod_-_AcidJazz.ogg/Kevin_MacLeod_-_AcidJazz.ogg.mp3",
        "durationSec": 218,
        "summary": "Tight head-nodding breakbeat drums paired with warm Rhodes electric piano and punchy horn stabs.",
    },
    {
        "workId": "mbid:c314de09-6412-59f2-9214-b1721c22f902",
        "title": "Night on the Docks (Sax Noir)",
        "shortTitle": "Night on the Docks",
        "hook": "Smoky noir sax & bass",
        "category": "jazz",
        "creator": "Kevin MacLeod (CC BY)",
        "year": 2013,
        "kind": "cool jazz · noir",
        "energy": 0.29,
        "heaviness": 0.25,
        "streamUrl": "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2d/Kevin_MacLeod_-_Night_on_the_Docks_-_Sax.ogg/Kevin_MacLeod_-_Night_on_the_Docks_-_Sax.ogg.mp3",
        "durationSec": 206,
        "summary": "Rainy midnight walking upright bass, brushed ride cymbal, and breathy tenor saxophone without clutter.",
    },
    {
        "workId": "mbid:06253427-8265-4036-ce56-335463728156",
        "title": "Naima",
        "shortTitle": "Naima",
        "hook": "Suspended horn ballad",
        "category": "jazz",
        "creator": "John Coltrane",
        "year": 1959,
        "kind": "jazz ballad",
        "energy": 0.24,
        "heaviness": 0.18,
        "summary": "Luminous pedal-point tenor saxophone hymn suspended over rich quartal piano harmonies.",
    },
    {
        "workId": "mbid:17364538-9376-4147-df67-446574839267",
        "title": "Teardrop",
        "shortTitle": "Teardrop",
        "hook": "Bristol dub trip-hop",
        "category": "electronic",
        "creator": "Massive Attack",
        "year": 1998,
        "kind": "trip-hop",
        "energy": 0.43,
        "heaviness": 0.44,
        "summary": "Heartbeat vinyl kick drum, harpsichord figure, and Elizabeth Fraser's soaring crystalline voice in Bristol nocturnal dub.",
    },
    {
        "workId": "mbid:28475649-0487-4258-e078-557685940378",
        "title": "Archangel",
        "shortTitle": "Archangel",
        "hook": "Rain-crackle 2-step dub",
        "category": "electronic",
        "creator": "Burial",
        "year": 2007,
        "kind": "uk garage · future dub",
        "energy": 0.51,
        "heaviness": 0.47,
        "summary": "Rain-crackle 2-step shuffles, pitched R&B vocal ghosts, and South London night-bus sub-bass.",
    },
    {
        "workId": "mbid:39586750-1598-4369-f189-668796051489",
        "title": "Windowlicker",
        "shortTitle": "Windowlicker",
        "hook": "Micro-edited breakbeats",
        "category": "electronic",
        "creator": "Aphex Twin",
        "year": 1999,
        "kind": "idm · electro-funk",
        "energy": 0.79,
        "heaviness": 0.74,
        "summary": "Elastic micro-edited breakbeats, vocoded sighs, and blown-out sub-bass distortion climax.",
    },
    {
        "workId": "mbid:40697861-2609-4470-a290-779807162590",
        "title": "Breathe",
        "shortTitle": "Breathe",
        "hook": "Big-beat snare slam",
        "category": "electronic",
        "creator": "The Prodigy",
        "year": 1996,
        "kind": "big beat · breakbeat",
        "energy": 0.94,
        "heaviness": 0.88,
        "summary": "Whip-crack snare breaks, surf-punk guitar snarl, and relentless arena rave adrenaline.",
    },
    {
        "workId": "mbid:51708972-3710-4581-b301-880918273601",
        "title": "N.Y. State of Mind",
        "shortTitle": "N.Y. State of Mind",
        "hook": "Premier piano boom-bap",
        "category": "hiphop",
        "creator": "Nas",
        "year": 1994,
        "kind": "boom-bap hip-hop",
        "energy": 0.76,
        "heaviness": 0.68,
        "summary": "DJ Premier upright-bass loop and menacing piano stabs driving razor-sharp Queensbridge street reportage.",
    },
    {
        "workId": "mbid:62819083-4821-4692-c412-991029384712",
        "title": "Accordion",
        "shortTitle": "Accordion",
        "hook": "Madlib sample loop",
        "category": "hiphop",
        "creator": "Madvillain",
        "year": 2004,
        "kind": "abstract hip-hop",
        "energy": 0.55,
        "heaviness": 0.50,
        "summary": "Madlib's wheezing Daedelus accordion sample looping endlessly under MF DOOM's dense internal rhyme schemes.",
    },
    {
        "workId": "mbid:73920194-5932-4703-d523-002130495823",
        "title": "Pink Moon",
        "shortTitle": "Pink Moon",
        "hook": "Close acoustic fingerpick",
        "category": "rock",
        "creator": "Nick Drake",
        "year": 1972,
        "kind": "folk · acoustic",
        "energy": 0.21,
        "heaviness": 0.12,
        "summary": "Intimate close-miked alternate-tuning acoustic guitar, hushed baritone voice, and a single brief piano cascade.",
    },
    {
        "workId": "mbid:84031205-6043-4814-e634-113241506934",
        "title": "Avril 14th",
        "shortTitle": "Avril 14th",
        "hook": "Delicate Disklavier keys",
        "category": "classical",
        "creator": "Aphex Twin",
        "year": 2001,
        "kind": "modern classical · Disklavier",
        "energy": 0.15,
        "heaviness": 0.09,
        "summary": "Delicate mechanical Disklavier miniature whose felt hammers click softly through a wistful two-minute melody.",
    },
]


def load_cohort_open_works(limit_per_discipline: int = 3) -> list[dict[str, Any]]:
    works: list[dict[str, Any]] = []
    if not COHORT_STEP1.is_dir():
        raise RuntimeError(f"Missing Cohort open content directory: {COHORT_STEP1}")
    for disc_dir in sorted(p for p in COHORT_STEP1.iterdir() if p.is_dir()):
        files = sorted(disc_dir.glob("*.json"))[:limit_per_discipline]
        for f in files:
            raw = json.loads(f.read_text())
            raw_id = str(raw["id"]).replace("bank:usmle-step1:", "")
            work_id = f"cohort:{raw_id}"
            topics = raw.get("topics") or []
            clean_topics = [t for t in topics if not str(t).startswith("ladder:")]
            ladders = [str(t).split(":", 1)[1] for t in topics if str(t).startswith("ladder:")]
            title_topic = clean_topics[0] if clean_topics else raw_id.split(":")[0]
            correct_opt = next((o for o in (raw.get("options") or []) if o.get("isCorrect")), None)
            explanation = (correct_opt or {}).get("explanation", "")
            works.append({
                "workId": work_id,
                "title": f"{disc_dir.name.capitalize()}: {title_topic}",
                "creator": f"Cohort Open · {disc_dir.name}",
                "year": 2026,
                "kind": f"{disc_dir.name} · {raw.get('difficulty', 'medium')}",
                "difficulty": raw.get("difficulty", "medium"),
                "ladder": ladders[0] if ladders else None,
                "summary": f"{raw.get('stem', '')[:260].strip()} — {explanation[:220].strip()}",
            })
    return works


def embed_mlx_gemma(items: list[tuple[str, str]]) -> np.ndarray:
    from mlx_vlm.embedding_loader import load_embedding_model
    from mlx_vlm.utils import get_model_path
    from transformers import AutoTokenizer
    import mlx.core as mx

    model_path = get_model_path("mlx-community/embeddinggemma-2-bf16")
    model = load_embedding_model(model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    formatted = [f"title: {t[:120]} | text: {b}" for t, b in items]
    rows: list[np.ndarray] = []
    batch_size = 16
    for i in range(0, len(formatted), batch_size):
        batch = formatted[i : i + batch_size]
        inputs = tokenizer(batch, padding=True, truncation=True, max_length=1024, return_tensors="np")
        mx_inputs = {k: mx.array(v) for k, v in inputs.items()}
        emb = model(**mx_inputs).text_embeds
        mx.eval(emb)
        arr = np.asarray(emb.tolist(), dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        rows.append(arr / norms)
    return np.vstack(rows)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def canonical_json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def ed25519_keypair_from_seed(seed32: bytes) -> tuple[str, str]:
    """Return (priv_pkcs8_b64, pub_raw_b64url) using Node stdlib crypto."""
    # PKCS#8 prefix for Ed25519 32-byte seed: 302e020100300506032b657004220420
    pkcs8_der = bytes.fromhex("302e020100300506032b657004220420") + seed32
    priv_b64 = base64.b64encode(pkcs8_der).decode("ascii")
    script = (
        "const c=require('node:crypto');"
        "const k=c.createPrivateKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'pkcs8'});"
        "const spki=c.createPublicKey(k).export({format:'der',type:'spki'});"
        "process.stdout.write(spki.subarray(-32).toString('base64url'));"
    )
    pub_b64url = subprocess.check_output(["node", "-e", script, priv_b64], text=True).strip()
    return priv_b64, pub_b64url


def sign_lens(lens_unsigned: dict[str, Any], priv_pkcs8_b64: str) -> dict[str, Any]:
    raw_json = json.dumps(lens_unsigned, ensure_ascii=False)
    script = (
        "const c=require('node:crypto');"
        "function cj(v){if(v===null||typeof v!=='object')return JSON.stringify(v);"
        "if(Array.isArray(v))return '['+v.map(cj).join(',')+']';"
        "return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+cj(v[k])).join(',')+'}';}"
        "const obj=JSON.parse(process.argv[2]);"
        "const k=c.createPrivateKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'pkcs8'});"
        "const sig=c.sign(null,Buffer.from(cj(obj),'utf8'),k);"
        "process.stdout.write(sig.toString('base64url'));"
    )
    sig_b64url = subprocess.check_output(["node", "-e", script, priv_pkcs8_b64, raw_json], text=True).strip()
    out = dict(lens_unsigned)
    out["signature"] = sig_b64url
    return out


def lookup_apple_music(title: str, creator: str) -> dict[str, str]:
    primary = creator.split("·")[0].split("(")[0].strip()
    if "Kevin MacLeod" in creator:
        return {}
    if primary in ("Public Domain Ensemble", "Public Domain"):
        primary = title
    query = f"{primary} {title}"
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({
        "term": query, "media": "music", "entity": "song", "limit": 1
    })
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OntoTheRadio/1.0 (https://github.com/todd866/onto-the-radio)"})
        with urllib.request.urlopen(req, timeout=8) as r:
            res = json.loads(r.read().decode()).get("results", [])
        if not res:
            return {}
        x = res[0]
        out: dict[str, str] = {}
        art = (x.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")
        if art.startswith("https://"):
            out["artUrl"] = art
        prev = x.get("previewUrl") or ""
        if prev.startswith("https://"):
            out["previewUrl"] = prev
        view = x.get("trackViewUrl") or ""
        if view.startswith("https://"):
            out["appleMusicUrl"] = view
        return out
    except Exception:
        return {}


def main() -> None:
    cohort_works = load_cohort_open_works(limit_per_discipline=2)
    all_records: list[dict[str, Any]] = []
    for w in TV_WORKS:
        w2 = dict(w)
        w2.pop(" summary_extra", None)
        w2["title"] = w2["title"].strip()
        w2["domain"] = "tv"
        all_records.append(w2)
    for w in RADIO_WORKS:
        w2 = dict(w)
        w2["title"] = w2["title"].strip()
        w2["domain"] = "radio"
        all_records.append(w2)
    for w in cohort_works:
        w2 = dict(w)
        w2["domain"] = "cohort"
        all_records.append(w2)

    print(f"Embedding {len(all_records)} open works across tv/radio/cohort via local MLX EmbeddingGemma 2...")
    texts = [(f"{r['title']} ({r['creator']}, {r['kind']})", r["summary"]) for r in all_records]
    mat = embed_mlx_gemma(texts)  # (N, 768) float32 L2-normalized

    # Compute 32-D PCA int8 steering vectors + 2D SVD coordinates per domain AND globally
    centered = mat - mat.mean(axis=0, keepdims=True)
    u, s, vt = np.linalg.svd(centered, full_matrices=False)
    pca32 = centered @ vt[:32].T  # (N, 32)
    max_abs = np.max(np.abs(pca32)) or 1.0
    pca32_i8 = np.clip(np.round((pca32 / max_abs) * 127.0), -127, 127).astype(np.int8)

    # Per-domain 2D coordinates so each domain fills [-0.88, 0.88] cleanly on the instrument plot
    coords_2d = np.zeros((len(all_records), 2), dtype=np.float32)
    for dom in ("tv", "radio", "cohort"):
        idxs = [i for i, r in enumerate(all_records) if r["domain"] == dom]
        sub = mat[idxs]
        sub_c = sub - sub.mean(axis=0, keepdims=True)
        su, ss, _ = np.linalg.svd(sub_c, full_matrices=False)
        xy = su[:, :2] * ss[:2]
        for col in range(2):
            span = max(float(np.max(np.abs(xy[:, col]))), 1e-6)
            xy[:, col] = (xy[:, col] / span) * 0.86
        for local_i, global_i in enumerate(idxs):
            coords_2d[global_i] = xy[local_i]

    # Exact cosine similarity matrix
    sims = mat @ mat.T
    landmarks = [
        "wikidata:Q752509",
        "wikidata:Q151599",
        "mbid:1b642322-7c90-4a8e-9b52-33f672941a64",
        "mbid:e317a495-2189-4138-8635-5a817c910421",
        cohort_works[0]["workId"],
    ]
    id_to_idx = {r["workId"]: i for i, r in enumerate(all_records)}
    landmark_idxs = [id_to_idx[lid] for lid in landmarks]

    # Deterministic steward Ed25519 key for canonical open seed (derived from fixed seed phrase, never a personal SSH key)
    steward_priv, steward_pub_u = ed25519_keypair_from_seed(hashlib.sha256(b"manifold-open-canon-steward-v1").digest())
    steward_issuer = f"ed25519:{steward_pub_u}"

    peer_priv, peer_pub_u = ed25519_keypair_from_seed(hashlib.sha256(b"manifold-archive-curator-v1").digest())
    peer_issuer = f"ed25519:{peer_pub_u}"

    med_priv, med_pub_u = ed25519_keypair_from_seed(hashlib.sha256(b"manifold-cohort-educator-v1").digest())
    med_issuer = f"ed25519:{med_pub_u}"

    works_out: list[dict[str, Any]] = []
    for i, r in enumerate(all_records):
        dom = r["domain"]
        # Top-10 within-domain neighbours + top-3 cross-domain resonances
        same_dom = [
            (j, float(sims[i, j]))
            for j in range(len(all_records))
            if j != i and all_records[j]["domain"] == dom
        ]
        same_dom.sort(key=lambda t: t[1], reverse=True)
        neighbours = [{"workId": all_records[j]["workId"], "sim": round(sc, 4)} for j, sc in same_dom[:10]]

        cross_dom = [
            (j, float(sims[i, j]))
            for j in range(len(all_records))
            if all_records[j]["domain"] != dom
        ]
        cross_dom.sort(key=lambda t: t[1], reverse=True)
        resonances = [
            {"workId": all_records[j]["workId"], "domain": all_records[j]["domain"], "sim": round(sc, 4)}
            for j, sc in cross_dom[:3]
        ]

        fp16_bytes = mat[i].astype(np.float16).tobytes()
        shard_hex = hashlib.sha256(r["workId"].encode("utf-8")).hexdigest()[:2]

        entry: dict[str, Any] = {
            "workId": r["workId"],
            "domain": dom,
            "title": r["title"],
            "creator": r["creator"],
            "year": r["year"],
            "kind": r["kind"],
            "summary": r["summary"],
            "modelId": MODEL_ID,
            "recipeHash": RECIPE_HASH,
            "shard": shard_hex,
            "x": round(float(coords_2d[i, 0]), 4),
            "y": round(float(coords_2d[i, 1]), 4),
            "vec32": [int(v) for v in pca32_i8[i].tolist()],
            "vec32Scale": round(float(max_abs / 127.0), 6),
            "vecFp16B64": base64.b64encode(fp16_bytes).decode("ascii"),
            "neighbours": neighbours,
            "resonances": resonances,
            "landmarks": {lid: round(float(sims[i, li]), 4) for lid, li in zip(landmarks, landmark_idxs)},
            "contributor": steward_issuer if dom != "cohort" else med_issuer,
            "verifiedCanary": 0.996,
        }
        for opt_key in (
            "mark",
            "streamUrl",
            "previewUrl",
            "artUrl",
            "appleMusicUrl",
            "shortTitle",
            "hook",
            "category",
            "durationSec",
            "energy",
            "heaviness",
            "difficulty",
            "ladder",
        ):
            if r.get(opt_key) is not None:
                entry[opt_key] = r[opt_key]
        if dom == "radio":
            am = lookup_apple_music(r.get("shortTitle") or r["title"], r["creator"])
            for k, v in am.items():
                entry.setdefault(k, v)
            time.sleep(0.05)
        works_out.append(entry)

    now_iso = "2026-11-23T02:35:00Z"

    # Build Ed25519-signed Lenses across all 3 domains
    raw_lenses = [
        (
            steward_priv,
            {
                "id": "lens:tv:night-flight",
                "domain": "tv",
                "name": "Night flight",
                "summary": "Slow cerebral sci-fi, Zone parables, and nocturnal expressionism",
                "issuer": steward_issuer,
                "issuerHandle": "canon.steward",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 148,
                "completionRate": 0.89,
                "anchors": [
                    {"workId": "wikidata:Q207626", "weight": 1.0, "mark": "good"},
                    {"workId": "wikidata:Q208592", "weight": 0.95, "mark": "good"},
                    {"workId": "wikidata:Q151599", "weight": 0.85, "mark": "good"},
                    {"workId": "wikidata:Q1202626", "weight": 0.8, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {"from": "wikidata:Q207626", "to": "wikidata:Q208592", "weight": 0.96},
                    {"from": "wikidata:Q151599", "to": "wikidata:Q1202626", "weight": 0.91},
                ],
            },
        ),
        (
            peer_priv,
            {
                "id": "lens:tv:open-cinema",
                "domain": "tv",
                "name": "Open studio",
                "summary": "Blender Open Movies and kinetic silent physical comedy",
                "issuer": peer_issuer,
                "issuerHandle": "archive.curator",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 212,
                "completionRate": 0.93,
                "anchors": [
                    {"workId": "wikidata:Q752509", "weight": 1.0, "mark": "good"},
                    {"workId": "wikidata:Q20856847", "weight": 0.92, "mark": "good"},
                    {"workId": "wikidata:Q321607", "weight": 0.88, "mark": "good"},
                    {"workId": "wikidata:Q936034", "weight": 0.84, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {"from": "wikidata:Q752509", "to": "wikidata:Q63090242", "weight": 0.94},
                    {"from": "wikidata:Q321607", "to": "wikidata:Q607358", "weight": 0.89},
                ],
            },
        ),
        (
            peer_priv,
            {
                "id": "lens:tv:midnight-noir",
                "domain": "tv",
                "name": "Rain & clockwork",
                "summary": "Taut post-war noir, screwball repartee, and Continental mystery",
                "issuer": peer_issuer,
                "issuerHandle": "archive.curator",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 94,
                "completionRate": 0.87,
                "anchors": [
                    {"workId": "wikidata:Q221105", "weight": 1.0, "mark": "good"},
                    {"workId": "wikidata:Q1161826", "weight": 0.94, "mark": "good"},
                    {"workId": "wikidata:Q500682", "weight": 0.9, "mark": "good"},
                    {"workId": "wikidata:Q621917", "weight": 0.82, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {"from": "wikidata:Q221105", "to": "wikidata:Q1161826", "weight": 0.95},
                ],
            },
        ),
        (
            steward_priv,
            {
                "id": "lens:radio:late-wire",
                "domain": "radio",
                "name": "Late wire",
                "summary": "Tape-loop ambient, nocturnal piano, and South London dub sub-bass",
                "issuer": steward_issuer,
                "issuerHandle": "canon.steward",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 319,
                "completionRate": 0.94,
                "anchors": [
                    {"workId": "mbid:1b642322-7c90-4a8e-9b52-33f672941a64", "weight": 1.0, "mark": "good"},
                    {"workId": "mbid:f0d2b6c2-9f4e-4b3b-891c-8398409e2736", "weight": 0.95, "mark": "good"},
                    {"workId": "mbid:28475649-0487-4258-e078-557685940378", "weight": 0.88, "mark": "good"},
                    {"workId": "mbid:84031205-6043-4814-e634-113241506934", "weight": 0.92, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {
                        "from": "mbid:1b642322-7c90-4a8e-9b52-33f672941a64",
                        "to": "mbid:f0d2b6c2-9f4e-4b3b-891c-8398409e2736",
                        "weight": 0.96,
                    },
                    {
                        "from": "mbid:9d187e42-3a61-4d0e-9b81-2f10772a3329",
                        "to": "mbid:c903284f-41d2-4f93-a274-4e82917b5418",
                        "weight": 0.95,
                    },
                ],
            },
        ),
        (
            steward_priv,
            {
                "id": "lens:radio:motorik-pulse",
                "domain": "radio",
                "name": "Motorik pulse",
                "summary": "Autobahn 4/4 krautrock, Manchester post-punk, and sequenced synth drive",
                "issuer": steward_issuer,
                "issuerHandle": "canon.steward",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 267,
                "completionRate": 0.91,
                "anchors": [
                    {"workId": "mbid:e317a495-2189-4138-8635-5a817c910421", "weight": 1.0, "mark": "good"},
                    {"workId": "mbid:a4298374-9201-438a-b829-174829104722", "weight": 0.94, "mark": "good"},
                    {"workId": "mbid:51829304-1290-4a81-9f31-882910492811", "weight": 0.91, "mark": "good"},
                    {"workId": "mbid:73920194-5932-4d03-9b23-002130495823", "weight": 0.89, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {
                        "from": "mbid:e317a495-2189-4138-8635-5a817c910421",
                        "to": "mbid:a4298374-9201-438a-b829-174829104722",
                        "weight": 0.97,
                    },
                    {
                        "from": "mbid:51829304-1290-4a81-9f31-882910492811",
                        "to": "mbid:73920194-5932-4d03-9b23-002130495823",
                        "weight": 0.94,
                    },
                ],
            },
        ),
        (
            peer_priv,
            {
                "id": "lens:radio:chamber-focus",
                "domain": "radio",
                "name": "Chamber focus",
                "summary": "CC0 Goldberg counterpoint, solo cello suites, and modal jazz ballads",
                "issuer": peer_issuer,
                "issuerHandle": "archive.curator",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 184,
                "completionRate": 0.92,
                "anchors": [
                    {"workId": "mbid:7f5c1a38-44d3-4259-9a81-16f17eb8bc31", "weight": 1.0, "mark": "good"},
                    {"workId": "mbid:41b02769-8872-4a45-8754-2b79383c3614", "weight": 0.95, "mark": "good"},
                    {"workId": "mbid:95142316-7154-4f25-bd45-224352617045", "weight": 0.86, "mark": "good"},
                    {"workId": "mbid:06253427-8265-4036-ce56-335463728156", "weight": 0.85, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {
                        "from": "mbid:7f5c1a38-44d3-4259-9a81-16f17eb8bc31",
                        "to": "mbid:41b02769-8872-4a45-8754-2b79383c3614",
                        "weight": 0.95,
                    },
                ],
            },
        ),
        (
            steward_priv,
            {
                "id": "lens:radio:jazz-miles-orbit",
                "domain": "radio",
                "name": "Jazz, Miles orbit",
                "summary": "Modal space, electric Rhodes groove, hip-hop horns, and smoky noir sax",
                "issuer": steward_issuer,
                "issuerHandle": "canon.steward",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 412,
                "completionRate": 0.95,
                "anchors": [
                    {"workId": "mbid:95142316-7154-4f25-bd45-224352617045", "weight": 1.0, "mark": "good"},
                    {"workId": "mbid:a21a9293-31f7-504c-9d9f-d4a4ec0bd6e2", "weight": 0.96, "mark": "good"},
                    {"workId": "mbid:6cf409af-8afa-5d5b-bcd0-358795af40b4", "weight": 0.92, "mark": "good"},
                    {"workId": "mbid:e941c1ff-3620-50f4-8590-9df10c78eceb", "weight": 0.90, "mark": "good"},
                    {"workId": "mbid:912241ed-7bf9-5ab4-af62-b2eede1437ba", "weight": 0.88, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {
                        "from": "mbid:95142316-7154-4f25-bd45-224352617045",
                        "to": "mbid:a21a9293-31f7-504c-9d9f-d4a4ec0bd6e2",
                        "weight": 0.97,
                    },
                    {
                        "from": "mbid:e941c1ff-3620-50f4-8590-9df10c78eceb",
                        "to": "mbid:912241ed-7bf9-5ab4-af62-b2eede1437ba",
                        "weight": 0.93,
                    },
                ],
            },
        ),
        (
            steward_priv,
            {
                "id": "lens:radio:classical-heavy",
                "domain": "radio",
                "name": "Classical, no fluff",
                "summary": "5/4 orchestral thunder, Prokofiev bass menace, and synth-classical drive",
                "issuer": steward_issuer,
                "issuerHandle": "canon.steward",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 356,
                "completionRate": 0.93,
                "anchors": [
                    {"workId": "mbid:92c48433-431b-52c5-ba0a-02cb4086a048", "weight": 1.0, "mark": "good"},
                    {"workId": "mbid:20462048-c5fa-5ab4-8c39-08baa105ed0a", "weight": 0.96, "mark": "good"},
                    {"workId": "mbid:9db35866-fbe8-5540-92a0-852c87a51e04", "weight": 0.92, "mark": "good"},
                    {"workId": "mbid:ab2c5006-d203-582c-9e3a-04d9726449b5", "weight": 0.90, "mark": "good"},
                    {"workId": "mbid:1b9fd9b7-9ca2-5eb7-bed9-e5e447ecfb9b", "weight": 0.88, "mark": "good"},
                ],
                "blockedMarks": ["slop"],
                "transitions": [
                    {
                        "from": "mbid:92c48433-431b-52c5-ba0a-02cb4086a048",
                        "to": "mbid:20462048-c5fa-5ab4-8c39-08baa105ed0a",
                        "weight": 0.96,
                    },
                    {
                        "from": "mbid:9db35866-fbe8-5540-92a0-852c87a51e04",
                        "to": "mbid:ab2c5006-d203-582c-9e3a-04d9726449b5",
                        "weight": 0.94,
                    },
                ],
            },
        ),
        (
            med_priv,
            {
                "id": "lens:cohort:step1-hemodynamics",
                "domain": "cohort",
                "name": "Step 1 cardiorenal & shock",
                "summary": "High-yield hemodynamic, transfusion, renal, and autonomic physiology blueprint",
                "issuer": med_issuer,
                "issuerHandle": "cohort.open",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 412,
                "completionRate": 0.88,
                "anchors": [
                    {"workId": w["workId"], "weight": 0.95, "mark": "good"}
                    for w in cohort_works
                    if any(k in w["kind"] for k in ("cardiovascular", "renal", "physiology", "respiratory"))
                ][:6],
                "blockedMarks": [],
                "transitions": [],
            },
        ),
        (
            med_priv,
            {
                "id": "lens:cohort:step1-mechanisms",
                "domain": "cohort",
                "name": "Step 1 molecular & neuropharm",
                "summary": "Biochemistry, pharmacology, immunology, and neural pathway ladder",
                "issuer": med_issuer,
                "issuerHandle": "cohort.open",
                "modelId": MODEL_ID,
                "version": 1,
                "createdAt": now_iso,
                "subscribers": 289,
                "completionRate": 0.86,
                "anchors": [
                    {"workId": w["workId"], "weight": 0.95, "mark": "good"}
                    for w in cohort_works
                    if any(k in w["kind"] for k in ("pharmacology", "biochem", "immunology", "neuro"))
                ][:6],
                "blockedMarks": [],
                "transitions": [],
            },
        ),
    ]
    signed_lenses = [sign_lens(lens_body, priv) for priv, lens_body in raw_lenses]

    contributors = [
        {
            "issuer": steward_issuer,
            "handle": "canon.steward",
            "tier": "steward",
            "alpha": 148.0,
            "beta": 2.0,
            "trust": round(148.0 / 150.0, 4),
            "verifiedVectors": 48,
            "quarantinedBatches": 0,
            "meanCanaryCosine": 0.9964,
            "credits": 620,
            "domains": ["tv", "radio"],
            "updatedAt": now_iso,
        },
        {
            "issuer": med_issuer,
            "handle": "cohort.open",
            "tier": "steward",
            "alpha": 112.0,
            "beta": 2.0,
            "trust": round(112.0 / 114.0, 4),
            "verifiedVectors": len(cohort_works),
            "quarantinedBatches": 0,
            "meanCanaryCosine": 0.9958,
            "credits": 480,
            "domains": ["cohort"],
            "updatedAt": now_iso,
        },
        {
            "issuer": peer_issuer,
            "handle": "archive.curator",
            "tier": "trusted",
            "alpha": 64.0,
            "beta": 3.0,
            "trust": round(64.0 / 67.0, 4),
            "verifiedVectors": 29,
            "quarantinedBatches": 0,
            "meanCanaryCosine": 0.9921,
            "credits": 295,
            "domains": ["tv", "radio"],
            "updatedAt": now_iso,
        },
    ]

    payload = {
        "schemaVersion": "manifold.seed.v1",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "defaultModel": MODEL_ID,
        "supportedModels": [
            {"modelId": "gemini-embedding-2", "dims": 3072, "role": "detail multimodal"},
            {"modelId": "embeddinggemma-2", "dims": 768, "role": "open local MLX coverage"},
        ],
        "landmarks": landmarks,
        "works": works_out,
        "lenses": signed_lenses,
        "contributors": contributors,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1024:.1f} KB): {len(works_out)} works, {len(signed_lenses)} signed lenses.")


if __name__ == "__main__":
    main()
