# My Thoughts on Life

A personal Markdown notebook for `mythoughtsonlife.com`. MdReader loads public content directly from GitHub or GitLab.com. The same static HTML runs from Cloudflare Pages or directly from disk.

## Configure the notebook

1. The site opens [MyThoughtsOnLife/Thoughts](https://github.com/MyThoughtsOnLife/Thoughts) by default. In `src/data/collections.js`, set `primaryCollection.ref` to open a specific branch or tag.
2. Add guest notebooks to the `collections` array using `{ name, description, url }`. Readers can also paste a public repository or file link in the collection picker.
3. To enable age displays, set `primaryCollection.author` or add the following optional file at the root of the **content repository**. This example uses a fictional author and date. Use `YYYY-MM-DD` or `DD.MM.YYYY` for the birth date. The birth date is public when supplied through either configuration route.

```json
{
  "title": "My Thoughts on Life",
  "description": "A notebook for thoughts, questions, and findings worth keeping.",
  "author": {
    "name": "Example Author",
    "birthDate": "1999-10-12"
  }
}
```

Save this file as `.mdreader.json`. Repository metadata overrides the settings for that collection. The Git timeline and comparison picker show the configured author's age on the civil date of each revision.

## Write and browse

The published notebook hides the root README and paths with a leading-dot name, such as `.gitignore` or `.github/workflows`. These files remain available in **Edit** and ZIP exports. Put `about.md` at the root of the content repository to enable the **About** link. Use `{{ Date }}` and `{{ Age }}` in its prose to display today's date and the author's age. Capitalization is optional. The age field shows a dash until a valid birth date is available. These fields are plain text and stay literal in code blocks and inline code.

Use YAML frontmatter to organize notes:

```markdown
---
title: An afternoon on the river
date: 2025-10-11
description: Notes from four observation points along a bend.
tags: [fieldwork, rivers]
---
```

In **Edit** mode, the **Tags** action edits the same frontmatter. **Search notebook** finds file paths, note titles, tags, and Markdown body text within the selected revision. Use **Content** for body matches or a query such as `tag:"fieldwork"` for an exact tag. Keyboard users can press **Ctrl K** or **⌘ K** to open search.

Select a commit in **Git history** to browse the repository at that revision. Use **Compare revisions** to choose two committed versions in the reading pane. Markdown keeps its formatting, with additions highlighted in green and removals in red. Other text files use a line-by-line view. The **Repository** history tab includes other paths, such as changes made before a rename. On a hosted copy, **Share** copies a link to a file or revision.

Drafts are saved in the current browser. **Export ZIP** includes the displayed snapshot and, when viewing the latest revision, its local changes and attachments. Extract the ZIP before uploading or committing the files.

## Embed media

```markdown
![Chart](assets/chart.png)
![[assets/Handout.pdf#page=2|640x450]]
![[experiments/Model.html|640x380]]
[[notes/Observation|Read the observation]]
![[notes/Observation#Method]]
```

Standard Markdown image syntax also embeds a relative PDF or HTML file. HTML previews run in an isolated iframe and can load repository-relative scripts, stylesheets, media, and JavaScript modules. Widgets can fetch explicit HTTPS URLs if the server allows cross-origin requests. Provider rate limits apply to public API requests. Open a submodule's repository separately to browse its files.

## Run locally and host on Cloudflare Pages

```sh
npm ci
npm run dev
npm test
npm run build
```

Use Node.js 22 for development and builds. The build creates one self-contained file at `dist/index.html`. Browsing public repositories requires an internet connection.

In Cloudflare Pages, use `npm run build` as the build command and `dist` as the output directory. You can also upload the built `dist` folder directly. Add `mythoughtsonlife.com` under the project's **Custom domains** after the domain is configured as a zone in the same Cloudflare account. The app uses query parameters for repository and revision links, so a static Pages deployment serves them from the same `index.html`. [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)

The Obsidian syntax renderer, editor formatting commands, and PDF viewer adapt code from the adjacent `obsidian-editor` project.


---

## Disclaimer

This project was created for personal use.
I used gpt 6.2 sol to code the website for me.
