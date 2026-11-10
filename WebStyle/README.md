# WebStyle

A crude Chromium extension for per-site font overrides to make a site's text use Helvetica and/or a "bold" weight.

- Add the current tab's URL (subdomains are included), customizing all fonts at the URL to use Helvetica, a "bold" weight, or both.
- Changes apply instantly to open tabs of customized sites.
- Export a .txt file to your downloads folder containing your configuration.
- Import a .txt-based backup to merge its contents with any existing entries (collisions are overwritten with the imported file's configuration).

Styles are injected before the page first paints, like Stylus. Icon fonts (Material Icons/Symbols, Font
Awesome, Glyphicons) are left alone so icons don't turn into words.

## Installation

Unzip the extension and place the folder somewhere permanent. Navigate to chrome://extensions, enable the "Developer Mode" toggle, click the "Load Unpacked" button, and select the WebStyle folder in the filesystem dialog.

## Support

If you find a bug, please report it here on GitHub and I will try to fix it. Please be as thorough in your reporting as you can.

You're welcome to request features or changes if you're so-inclined, and I will give such requests due consideration, but just know that this extension was built first and foremost for an audience of one and I consider it feature-complete at this time.

WebStyle is available in English only, by design.

## Note

I am not a software engineer; all of the code for this project was written by Anthropic's Claude models. That said, I use all of the applications under this account regularly in my daily life, so while they're not perfect, I'm confident in their efficacy and general reliability.

## License

WebStyle is free software, licensed under the GNU General Public License, version 3 only (GPL-3.0-only). Copyright © 2026 avenged110. The full license text is in `COPYING`.
