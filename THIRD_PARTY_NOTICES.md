# Third-party notices

LolzCloud is developed by Artemper (artemper_lzt, GitHub: [Artemper52](https://github.com/Artemper52)) and contributors. The notices below identify the authors and licenses of reused components.

LolzCloud includes modified code originally distributed as [BetterSoundCloud](https://github.com/AlirezaKJ/BetterSoundCloud) by Alireza Karimi Jafari, copyright 2023, under the MIT license. The original copyright and permission notice are preserved in `LICENSE`. LolzCloud is an independent fork; product branding and release infrastructure have been changed.

Some existing interface SVG glyphs are from Google Material Symbols, distributed under Apache License 2.0. The license is included in `licenses/Apache-2.0.txt`. The LolzCloud cloud/wave logo and the replacement theme glyphs are part of this project's MIT-licensed code.

Electron and npm dependencies retain their respective licenses. Electron's runtime license files are included in the packaged distribution; dependency license files remain alongside the bundled modules.

SoundCloud, Lolzteam and Discord names identify the services integrated with this application. Their service names and marks are not licensed by this repository's MIT license.

FFmpeg is bundled as a separate, unmodified command-line executable via `ffmpeg-static` 5.3.0. The Windows x64 executable is Gyan 6.1.1-essentials, licensed under GPL v3. The application invokes it on local temporary audio files; it is not linked into the JavaScript program. Its GPL license and original build information are included in `licenses/FFmpeg-GPL-3.0.txt` and `licenses/FFmpeg-Windows-build.txt`; the wrapper license is in `licenses/ffmpeg-static-GPL-3.0.txt`. Source for this exact FFmpeg revision: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93. Original binary/build provider: https://www.gyan.dev/ffmpeg/builds/. Distribution scripts and dependency build references: https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1. The independent LolzCloud JavaScript source retains its MIT license.

Linux x64 and ARM64 FFmpeg binaries come from [John Van Sickle](https://johnvansickle.com/ffmpeg/) through the same `ffmpeg-static` release. Their platform-specific build information and license are retained alongside the executable as `ffmpeg.README` and `ffmpeg.LICENSE`. FFmpeg source releases are available from [ffmpeg.org](https://ffmpeg.org/releases/); upstream binary provenance is documented in the [ffmpeg-static release](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1).
