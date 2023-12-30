import * as fs from 'fs/promises';
import * as path from 'path';

import { ObsidianDB } from '../lib/obsidiandb';
import { YoutubeOAuth } from '../lib/youtube';
import { YoutubeSync, YoutubeSyncOptions } from '../lib/youtube_sync_lib';

const CLIENT_SECRET_FILE = '.private/client_secret.json';
const TOKEN_FILE = '.private/youtube-sync.json';
const SETTINGS_FILE = '.private/settings.json';

type Settings = {
    "channel_id": string,
    "playlist_id": string,
    "vault_path": string,
    "video_folder": string,
    "video_thumbnail_folder": string,
    "channel_folder": string,
    "channel_thumbnail_folder": string
};

const settings: Settings = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8"));

const obsidian_db = await ObsidianDB.fromVault(settings.vault_path);
const youtube_auth = await YoutubeOAuth.fromClientSecretFile(CLIENT_SECRET_FILE);
const yt = await youtube_auth.authorise(TOKEN_FILE);

let syncOptions: YoutubeSyncOptions = {
    channel_id: settings.channel_id,
    playlist_id: settings.playlist_id,
    video_thumbnail_path: path.join(settings.vault_path, settings.video_thumbnail_folder),
    channel_thumbnail_path: path.join(settings.vault_path, settings.channel_thumbnail_folder),
    channel_template_file: "templates/youtube-channel.md.hbs",
    video_template_file: "templates/youtube-video.md.hbs",
    channel_folder: settings.channel_folder,
    video_folder: settings.video_folder,
};

let sync = new YoutubeSync(obsidian_db, yt, syncOptions);
await sync.sync();
