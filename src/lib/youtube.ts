import fs from 'fs/promises';
import url from 'url';
import path from 'path';

import http from 'http';

import moment from 'moment';
import 'moment-timezone';
import { google, youtube_v3 } from 'googleapis';
import { Credentials, OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];


export class YoutubeBuilder {
}


export class YoutubeOAuth {
    private client_id: string;
    private project_id: string;
    private auth_uri: string;
    private token_uri: string;
    private auth_provider_x509_cert_url: string;
    private client_secret: string;
    private redirect_uris: string[];

    constructor(client_id: string, project_id: string, auth_uri: string, token_uri: string, auth_provider_x509_cert_url: string, client_secret: string, redirect_uris: string[]) {
        this.client_id = client_id;
        this.project_id = project_id;
        this.auth_uri = auth_uri;
        this.token_uri = token_uri;
        this.auth_provider_x509_cert_url = auth_provider_x509_cert_url;
        this.client_secret = client_secret;
        this.redirect_uris = redirect_uris;
    }

    public static async fromClientSecretFile(filename: string): Promise<YoutubeOAuth> {
        let content = await fs.readFile('./client_secret.json', 'utf8');
        const secret = JSON.parse(content)["installed"];
        return new YoutubeOAuth(
            secret['client_id'],
            secret['project_id'],
            secret['auth_uri'],
            secret['token_uri'],
            secret['auth_provider_x509_cert_url'],
            secret['client_secret'],
            secret['redirect_uris']
        );
    }

    public async authorise(tokenfilename: string): Promise<YoutubeConnector> {
        const oauth2Client = new google.auth.OAuth2(
            this.client_id,
            this.client_secret,
            this.redirect_uris[0]
        );

        let exists = await fs.access(tokenfilename).then(() => true).catch(() => false);
        let credentials: Credentials = {};
        if (exists) {
            let content = await fs.readFile(tokenfilename, 'utf8');
            credentials = JSON.parse(content);
            if (!credentials.expiry_date || new Date(credentials.expiry_date) < new Date()) {
                exists = false;
            }
        }
        if (!exists) {
            credentials = await this.getNewToken(oauth2Client, tokenfilename);
        }
        oauth2Client.credentials = credentials;
        return new YoutubeConnector(oauth2Client);
    }

    private async getNewToken(oauth2Client: OAuth2Client, tokenfilename: string): Promise<object> {
        var authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES
        });
        console.log('Authorize this app by visiting this url: ', authUrl);
        const code = await startAuthServer();
        const token = await oauth2Client.getToken(code);
        await fs.writeFile(tokenfilename, JSON.stringify(token.tokens));
        return token.tokens;
    }
}


export class YoutubeConnector {
    auth: OAuth2Client;

    constructor(auth: OAuth2Client) {
        this.auth = auth;
    }

    public channel(id: string): YoutubeChannel {
        return new YoutubeChannel(this, id);
    }

    public async *videos() {
    }


    public async *channelDetails(ids: string[]) {
        ids = [...new Set(ids)];
        for (const id of ids) {
            yield await this.fetchChannelDetails(id);
        }
        // let page = await this.channelDetailsPage(ids);
        // for
        // yield* page.items!;
        // while (page.nextPageToken) {
        //     page = await this.fetchChannelDetails(ids);
        //     yield* page.items!;
        // }

    }

    private async channelDetailsPage(ids: string[], pageToken: string | undefined = undefined): Promise<{ items: YoutubeChannelDetails[], pageInfo: youtube_v3.Schema$PageInfo, nextPageToken: string | undefined }> {
        console.log(`Fetching channel details for ${ids.length} channels [${ids}]`);
        const response = await google.youtube('v3').channels.list({
            "auth": this.auth,
            "part": ["id", "snippet", "contentDetails", "statistics", "topicDetails", "brandingSettings", "status"],
            "id": ids,
            "maxResults": 10,
            "pageToken": pageToken
        });
        const data = response.data;
        const items = data.items;
        const pageInfo = data.pageInfo!;
        const nextPageToken = data.nextPageToken || undefined;
        return {
            items: items?.map((item) => { return new YoutubeChannelDetails(item) }) ?? [],
            pageInfo,
            nextPageToken,
        }
    }

    private async fetchChannelDetails(id: string): Promise<YoutubeChannelDetails> {
        const response = await google.youtube('v3').channels.list({
            "auth": this.auth,
            "part": ["id", "snippet", "contentDetails", "statistics", "topicDetails", "brandingSettings", "status"],
            "id": [id],
            "maxResults": 1
        });
        const data = response.data;
        const items = data.items;
        return new YoutubeChannelDetails(items![0]);
    }
}


export class YoutubeChannel {
    private connector: YoutubeConnector;
    private channel_id: string;

    constructor(connector: YoutubeConnector, channel_id: string) {
        this.connector = connector;
        this.channel_id = channel_id;
    }

    public playlist(id: string): YoutubePlaylist {
        return new YoutubePlaylist(this.connector, this.channel_id, id);
    }
}

export class YoutubeChannelDetails {
    private item: youtube_v3.Schema$Channel;

    constructor(item: youtube_v3.Schema$Channel) {
        this.item = item;
    }

    public get id(): string {
        return this.item.id!;
    }

    public get title(): string {
        return safeTitle(this.item.snippet!.title!)!;
    }

    public get name(): string {
        return `${this.title} (${this.id})`;
    }

    public get thumbnails(): youtube_v3.Schema$ThumbnailDetails {
        return this.item.snippet!.thumbnails!;
    }

    public get thumbnail(): youtube_v3.Schema$Thumbnail | undefined {
        if (!this.item.snippet?.thumbnails) {
            return undefined;
        }
        if (this.item.snippet?.thumbnails?.high) {
            return this.item.snippet?.thumbnails?.high;
        } else if (this.item.snippet?.thumbnails?.medium) {
            return this.item.snippet?.thumbnails?.medium;
        } else if (this.item.snippet?.thumbnails?.default) {
            return this.item.snippet?.thumbnails?.default;
        }
    }

    public get thumbnail_filename(): string | undefined {
        if (!this.thumbnail) {
            return undefined;
        }
        let extension = path.extname(this.thumbnail.url!) || ".jpg";
        return `youtube-channel-thumbnail-${this.id}${extension}`;
    }

    public get description(): string | undefined {
        if (!this.item.snippet?.description) {
            return undefined;
        }
        return sanitise(this.item.snippet?.description);
    }

    public get published(): string | undefined {
        if (!this.item.snippet?.publishedAt) {
            return undefined;
        }
        return this.item.snippet?.publishedAt!;
    }

    public get publishedHumanReadable(): string | undefined {
        if (!this.item.snippet?.publishedAt) {
            return undefined;
        }
        const date = new Date(this.item.snippet?.publishedAt!);
        return moment(date).tz("Europe/London").format("YYYY-MM-DD HH:mm:ss z");
    }

    public get country(): string | undefined {
        if (!this.item.snippet?.country) {
            return undefined;
        }
        return this.item.snippet?.country!;
    }

    public get url(): string | undefined {
        if (!this.item.snippet?.customUrl) {
            return `https://www.youtube.com/channel/${this.id}`
        }
        return `https://www.youtube.com/${this.item.snippet?.customUrl!}`;
    }
}


export class YoutubePlaylist {
    private connector: YoutubeConnector;
    private channel_id: string;
    private playlist_id: string;
    private service: youtube_v3.Youtube;

    constructor(connector: YoutubeConnector, channel_id: string, playlist_id: string) {
        this.connector = connector;
        this.channel_id = channel_id;
        this.playlist_id = playlist_id;
        this.service = google.youtube('v3');
    }

    public async *videos() {
        let page = await this.playlistPage();
        yield* page.items!;
        while (page.nextPageToken) {
            page = await this.playlistPage(page.nextPageToken);
            yield* page.items!;
        }
    }

    public async playlistPage(pageToken: string | undefined = undefined) {
        const response = await this.service.playlistItems.list({
            "auth": this.connector.auth,
            "part": ["id", "snippet", "contentDetails", "status"],
            "playlistId": this.playlist_id,
            "maxResults": 10,
            "pageToken": pageToken
        });
        const data = response.data;
        const pageInfo = data.pageInfo;
        const items = data.items;
        const nextPageToken = data.nextPageToken;
        return {
            items: items?.map((item) => { return new YoutubeVideoDetails(item) }),
            pageInfo,
            nextPageToken
        }
    }
}


export class YoutubeVideoDetails {
    private item: youtube_v3.Schema$PlaylistItem;

    constructor(item: youtube_v3.Schema$PlaylistItem) {
        this.item = item;
    }

    public get id(): string {
        return this.item.id!;
    }

    public get videoId(): string {
        return this.item.contentDetails!.videoId!;
    }

    public get title(): string {
        return safeTitle(this.item.snippet!.title!)!;
    }

    public get name(): string {
        return `${this.title} (${this.videoId})`;
    }

    public get thumbnails(): youtube_v3.Schema$ThumbnailDetails {
        return this.item.snippet!.thumbnails!;
    }

    public get thumbnail(): youtube_v3.Schema$Thumbnail | undefined {
        if (!this.item.snippet?.thumbnails) {
            return undefined;
        }
        if (this.item.snippet?.thumbnails?.maxres) {
            return this.item.snippet?.thumbnails?.maxres;
        } else if (this.item.snippet?.thumbnails?.standard) {
            return this.item.snippet?.thumbnails?.standard;
        } else if (this.item.snippet?.thumbnails?.high) {
            return this.item.snippet?.thumbnails?.high;
        } else if (this.item.snippet?.thumbnails?.medium) {
            return this.item.snippet?.thumbnails?.medium;
        } else if (this.item.snippet?.thumbnails?.default) {
            return this.item.snippet?.thumbnails?.default;
        }
    }

    public get thumbnail_filename(): string | undefined {
        if (!this.thumbnail) {
            return undefined;
        }
        let extension = path.extname(this.thumbnail.url!) || ".jpg";
        return `youtube-video-thumbnail-${this.videoId}${extension}`;
    }

    public get description(): string | undefined {
        if (!this.item.snippet?.description) {
            return undefined;
        }
        return sanitise(this.item.snippet?.description);
    }

    public get added(): string | undefined {
        if (!this.item.snippet?.publishedAt) {
            return undefined;
        }
        return this.item.snippet?.publishedAt!;
    }

    public get published(): string | undefined {
        if (!this.item.contentDetails?.videoPublishedAt) {
            return undefined;
        }
        return this.item.contentDetails?.videoPublishedAt!;
    }

    public get publishedHumanReadable(): string | undefined {
        if (!this.item.contentDetails?.videoPublishedAt) {
            return undefined;
        }
        const date = new Date(this.item.contentDetails?.videoPublishedAt!);
        return moment(date).tz("Europe/London").format("YYYY-MM-DD HH:mm:ss z");
    }


    public get channelId(): string {
        return this.item.snippet!.videoOwnerChannelId!;
    }

    public get channelTitle(): string {
        return safeTitle(this.item.snippet!.videoOwnerChannelTitle!)!;
    }

    public get channelName(): string {
        return `${this.channelTitle} (${this.channelId})`;
    }


}

function startAuthServer(): Promise<string> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const queryObject = url.parse(req.url!, true).query;
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Authentication successful. You can close this page.');

            server.close(); // Close the server after handling the request
            if (queryObject.code === undefined) reject('Code not found');
            if (typeof queryObject.code !== 'string') reject('Code is not a string');
            resolve(queryObject.code as string); // Resolve the promise with the authorization code
        });

        server.listen(80, () => {
            console.log('Server listening on http://localhost:80');
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

function safeTitle(title: string|undefined): string|undefined {
    if (!title) {
        return undefined;
    }
    return commonReplaces(title).replace(/[#]/g, '');
}

function sanitise(text: string): string {
    return commonReplaces(text).replace(/[#]/g, '`#`');
}

function commonReplaces(text: string) {
    return text.replace("[", '(').replace("]", ')');
}
