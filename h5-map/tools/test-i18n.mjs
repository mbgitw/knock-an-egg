import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLanguage,setLanguage,t} from '../public/i18n.js';
import {SettingsState,restoreSettings} from '../public/gameplay/settings-state.js';
test('host language fallback and explicit preference take precedence',()=>{
 assert.equal(resolveLanguage('auto','zh'),'zh');assert.equal(resolveLanguage('auto','zh-CN'),'zh');assert.equal(resolveLanguage('auto','fr'),'en');assert.equal(resolveLanguage('en','zh'),'en');assert.equal(resolveLanguage('zh','en'),'zh');
});
test('UI translation preserves numeric values, arbitrary names and supports both directions',()=>{
 setLanguage('zh');assert.equal(t('Top Money'),'收益排行榜');assert.equal(t('10 Speed'),'10 速度');assert.equal(t('@Cat'),'@Cat');assert.equal(t('$100'),'$100');assert.equal(t('Settings'),'设置');
 setLanguage('en');assert.equal(t('等级 2 → 3'),'Level 2 → 3');assert.equal(t('我的排名 #12'),'My rank #12');assert.equal(t('猫'),'Cat');
});
test('language preference restores old saves as auto and rejects invalid settings',()=>{
 assert.equal(restoreSettings({}).Language,'auto');assert.equal(restoreSettings({Language:'bad'}).Language,'auto');
 const a={data:{settings:{}},save:()=>true},s=new SettingsState(a);assert.equal(s.set('Language','zh'),true);assert.equal(s.set('Language','bad'),false);assert.equal(restoreSettings(JSON.parse(JSON.stringify(a.data.settings))).Language,'zh');s.dispose();
});

test('animal Bat and weapon Bat keep distinct Chinese names across language changes',()=>{
 setLanguage('zh');assert.equal(t('Bat','animal'),'蝙蝠');assert.equal(t('蝙蝠','animal'),'蝙蝠');assert.equal(t('Bat'),'球棒');assert.equal(t('Cat','animal'),'猫');
 setLanguage('en');assert.equal(t('蝙蝠','animal'),'Bat');assert.equal(t('球棒'),'Bat');
});
