import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import Handlebars from 'handlebars';

export class ObsidianDB {

  public readonly vault: string;
  public readonly notes: ObsidianNote[] = [];
  public readonly notes_by_tags: { [key: string]: ObsidianNote[] } = {};
  private templates: { [key: string]: HandlebarsTemplateDelegate } = {};

  constructor(vault: string, files: ObsidianNote[], tags: { [key: string]: ObsidianNote[] }) {
    this.vault = vault;
    this.notes = files;
    this.notes_by_tags = tags;
  }

  public get tags(): string[] {
    return Object.keys(this.notes_by_tags);
  }

  public search(tags: string[] = []): ObsidianNote[] {
    let files: ObsidianNote[] = [];
    for (const file of this.notes) {
      for (const tag of tags) {
        if (file.tags.includes(tag)) {
          files.push(file);
          break;
        }
      }
    }
    return files;
  }

  public find(predicate: (note: ObsidianNote) => boolean): ObsidianNote[] {
    return this.notes.filter(predicate);
  }

  public map(predicate: (note: ObsidianNote) => any): any[] {
    return this.notes.map(predicate);
  }

  public async addTemplatedFile(templateFile: string, folder: string, filename: string, data: object = {}) {
    let template = await this.getTemplate(templateFile);
    let content = template(data, { allowProtoPropertiesByDefault: true });
    let safeFilename = this.makeSafeFilename(filename);
    let file = path.join(this.vault, folder, safeFilename);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  public makeSafeFilename(filename: string): string {
    return filename
      .replace("’", "'")
      .replace("[", "(")
      .replace("]", ")")
      .replace(":", " -")
      .replace(/[/]+/gi, '-')
      .replace(/#/gi, '')
      .replace(/[^a-z0-9-_|.,?!@"&'\$\() ]/gi, '_');
  }

  public fileExists(filename: string): boolean {
    return this.notes.some((file) => { return file.baseFilename == filename });
  }

  private async getTemplate(filename: string): Promise<HandlebarsTemplateDelegate> {
    if (!this.templates[filename]) {
      let content = await fs.readFile(filename, 'utf8');
      this.templates[filename] = Handlebars.compile(content, { noEscape: true });
    }
    return this.templates[filename];
  }

  public static async fromVault(vault: string, exclude: string[] = []): Promise<ObsidianDB> {
    let files = [];
    let files_by_tags: { [key: string]: ObsidianNote[] } = {};
    for await (const fileName of ObsidianDB.fromFolder(vault, exclude)) {
      const file = await ObsidianNote.fromPath(vault, fileName);
      if (file) {
        files.push(file);
        for (const tag of file.tags) {
          if (!files_by_tags[tag]) {
            files_by_tags[tag] = [];
          }
          files_by_tags[tag].push(file);
        }
      }
    }
    return new ObsidianDB(vault, files, files_by_tags);
  }

  private static async *fromFolder(vault: string, exclude: string[] = [], folderPath: string = ""): AsyncGenerator<string> {
    let current = path.join(vault, folderPath);
    if (exclude.includes(folderPath)) {
      return;
    }
    let folder = await fs.readdir(current, { withFileTypes: true });
    for (const file of folder) {
      if (file.isDirectory() && file.name != ".obsidian") {
        yield* ObsidianDB.fromFolder(vault, exclude, `${folderPath}${file.name}/`);
      } else if (file.isFile() && file.name.endsWith(".md")) {
        yield `${folderPath}${file.name}`;
      }
    }
  }
}


export class ObsidianNote {
  public readonly vault: string;
  public readonly filename: string;
  public readonly baseFilename: string;
  public readonly content: object;
  public readonly title: string;
  public readonly folder: string;

  constructor(vault: string, filename: string, content: object) {
    this.vault = vault;
    this.filename = filename;
    this.content = content;
    this.folder = path.dirname(filename);
    this.title = path.basename(filename, ".md");
    this.baseFilename = path.basename(filename);
  }

  public get data(): object {
    return (this.content as { data: object })?.data || {};
  }

  public getData(key: string): string | null {
    return (this.content as { data: { [key: string]: string } })?.data?.[key] || null;
  }

  public get tags(): string[] {
    const tags = (this.content as { data: { tags: string[] } })?.data?.tags || [];
    const stereotype = this.stereotype;
    if (stereotype && !tags.includes(stereotype)) {
      tags.push(stereotype);
    }
    return tags.map((tag) => { return '#' + tag });
  }

  public get stereotype(): string | null {
    return (this.content as { data: { stereotype: string } })?.data?.stereotype || null;
  }

  static async fromPath(vault: string, filePath: string) {
    let content = await fs.readFile(path.join(vault, filePath));
    try {
      let data = matter(content);
      return new ObsidianNote(vault, filePath, data);
    } catch (e) {
      console.log("ERROR", filePath);
    }
  }


}
