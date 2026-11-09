import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {SFX} from '../public/gameplay/game-audio.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'assets','audio');
for(const dir of ['sfx','bgm','chase'])await mkdir(path.join(out,dir),{recursive:true});
for(const [file] of Object.values(SFX))await copyFile(path.join(root,'public/audio/sfx',file),path.join(out,'sfx',file));
await copyFile(path.join(root,'public/gameplay/settings-ui/9045766377.mp3'),path.join(out,'bgm/daily.mp3'));
for(const file of ['chase-alert-louder.wav','chase-music.mp3'])await copyFile(path.join(root,'public/audio/chase',file),path.join(out,'chase',file));
console.log('Builda native audio: 19 files prepared in assets/audio');
