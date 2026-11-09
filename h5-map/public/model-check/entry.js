const categories = {
  weapons: {title: '武器 / 球棒与电锤', module: './weapon-viewer.js'},
  trails: {title: '特效 / 拖尾', module: './trail-viewer.js'},
  pickaxes: {title: '工具 / 镐子', module: './viewer.js'},
  treadmills: {title: '设施 / 跑步机', module: './treadmill-viewer.js'},
  shops: {title: '设施 / 商店', module: './shop-viewer.js'},
  eggs: {title: '蛋', module: './creature-viewer.js'},
  animals: {title: '动物', module: './creature-viewer.js'},
  'paid-animals': {title: '付费动物 / Fallen Angel', module: './creature-viewer.js'},
};
const requested = location.hash.slice(1).split('/')[0];
const category = Object.hasOwn(categories, requested) ? requested : 'pickaxes';
document.querySelectorAll('[data-category]').forEach(button => {
  button.classList.toggle('active', button.dataset.category === category);
  button.onclick = () => {
    location.hash = button.dataset.category;
    location.reload();
  };
});
document.querySelector('#category-title').textContent = categories[category].title;
document.title = `${categories[category].title} · 模型检查 · Knock an Egg`;
document.body.dataset.category = category;
try {
  await import(categories[category].module);
} catch (error) {
  console.error(error);
  document.querySelector('#info').textContent = `资源加载失败：${error.message}`;
}
