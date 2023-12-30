import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

import { ObsidianDB } from "./obsidiandb";
import { YoutubeChannelDetails, YoutubeConnector, YoutubeVideoDetails } from "./youtube";

export type YoutubeSyncOptions = {
  channel_id: string;
  playlist_id: string;
  video_thumbnail_path: string;
  channel_thumbnail_path: string;
  channel_template_file: string;
  video_template_file: string;
  channel_folder: string;
  video_folder: string;
}

export class YoutubeSync {
  private obsidian: ObsidianDB;
  private youtube: YoutubeConnector;
  private options: YoutubeSyncOptions;
  private videos: YoutubeVideoDetails[] = [];
  private channels: YoutubeChannelDetails[] = [];

  constructor(obsidian: ObsidianDB, youtube: YoutubeConnector, options: YoutubeSyncOptions) {
      this.obsidian = obsidian;
      this.youtube = youtube;
      this.options = options;
  }

  public async sync() {
    await this.fetchVideos();
    await this.fetchChannels();
    await this.makeChannelNotes();
    await this.makeVideoNotes();
  }

  private async fetchVideos() {
    if (this.videos.length > 0) {
      return;
    }
    const obsidian_playlist = this.youtube.channel(this.options.channel_id).playlist(this.options.playlist_id);
    for await (const video of obsidian_playlist.videos()) {
      this.videos.push(video);
    }
    console.log(`Fetched ${this.videos.length} video details`);
  }

  private async fetchChannels() {
    if (this.channels.length > 0) {
      return;
    }
    let channelIds = this.videos.map((video) => { return video.channelId });
    channelIds = [...new Set(channelIds)];
    // let existingChannelIds = this.obsidian.map((note) => { return note.getData("youtube-channel-id") }).filter((id) => { return id != null }) as string[];
    // channelIds = channelIds.filter((id) => { return !existingChannelIds.includes(id) });
    for await (const channelDetail of this.youtube.channelDetails(channelIds)) {
      this.channels.push(channelDetail);
      console.log(`Fetched channel details: ${channelDetail.name}`);
    }
  }

  private async makeChannelNotes() {
    for (const channel of this.channels) {
      // if (this.obsidian.find((note) => { return note.getData(note.getData("id") == channel.id })) {
      //   continue;
      // }
      await this.downloadChannelThumbnail(channel);
      await this.obsidian.addTemplatedFile(
        this.options.channel_template_file,
        this.options.channel_folder,
        `${channel.name}.md`,
        channel
      );
    }
  }

  private async makeVideoNotes() {
    for (const video of this.videos) {
      // if (this.obsidian.find((note) => { return note.getData("youtube-video-id") == video.videoId })) {
      //   continue;
      // }
      await this.downloadVideoThumbnail(video);
      await this.obsidian.addTemplatedFile(
        this.options.video_template_file,
        this.options.video_folder,
        `${video.name}.md`,
        video
      );
    }
  }

  private async downloadChannelThumbnail(channel: YoutubeChannelDetails): Promise<string|undefined> {
    if (channel.thumbnail) {
      let thumbnail_filename = path.join(this.options.channel_thumbnail_path, channel.thumbnail_filename!);
      if (!fs.existsSync(thumbnail_filename)) {
        console.log(`Downloading thumbnail for channel ${channel.name}`);
        await this.downloadFile(channel.thumbnail.url!, thumbnail_filename);
      }
      return thumbnail_filename;
    }
  }

  private async downloadVideoThumbnail(video: YoutubeVideoDetails): Promise<string|undefined> {
    if (video.thumbnail) {
      let extension = path.extname(video.thumbnail.url!) || ".jpg";
      let thumbnail_filename = path.join(this.options.video_thumbnail_path, `youtube-video-thumbnail-${video.videoId}${extension}`);
      if (!fs.existsSync(thumbnail_filename)) {
        console.log(`Downloading thumbnail for video ${video.name}`);
        await this.downloadFile(video.thumbnail.url!, thumbnail_filename);
      }
      return thumbnail_filename;
    }
  }

  private async downloadFile(url: string, filename: string) {
    await fs.mkdirSync(path.dirname(filename), { recursive: true });

    const file = await fs.createWriteStream(filename);
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(null);
            });
        }).on('error', (error: Error) => {
            fs.unlink(filename, () => {});
            reject(error.message);
        });
    });
  }
}


