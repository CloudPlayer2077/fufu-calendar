'use strict';
/**
 * 游戏元数据与版本节奏知识。
 * cadence 仅用于「预测」提示，不是官方数据，前端必须标注为「预测」。
 */

const GAMES = [
  {
    id: 'genshin',
    name: '原神',
    fullName: '原神',
    enName: 'Genshin Impact',
    color: '#5B9BD5',
    accent: '#8FD3FF',
    glow: 'rgba(91,155,213,0.45)',
    cadence: { weeks: 6, weekday: 3, hour: 6, minute: 0 },
    keywords: ['原神', '提瓦特', '蒙德', '璃月', '稻妻', '须弥', '枫丹', '纳塔', '挪德卡莱', '旅行者', '祈愿'],
    mark: '原'
  },
  {
    id: 'zzz',
    name: '绝区零',
    fullName: '绝区零',
    enName: 'Zenless Zone Zero',
    color: '#FF7A45',
    accent: '#FFC08A',
    glow: 'rgba(255,122,69,0.45)',
    cadence: { weeks: 6, weekday: 3, hour: 6, minute: 0 },
    keywords: ['绝区零', '绳网', '新艾利都', '代理人', '邦布', '空洞', '六分街'],
    mark: '绝'
  },
  {
    id: 'hsr',
    name: '星穹铁道',
    fullName: '崩坏：星穹铁道',
    enName: 'Honkai: Star Rail',
    color: '#9B7BFF',
    accent: '#C9B6FF',
    glow: 'rgba(155,123,255,0.45)',
    cadence: { weeks: 6, weekday: 3, hour: 11, minute: 0 },
    keywords: ['星穹铁道', '星铁', '崩坏', '开拓者', '星穹列车', '仙舟', '匹诺康尼', '翁法罗斯'],
    mark: '星'
  },
  {
    id: 'endfield',
    name: '终末地',
    fullName: '明日方舟：终末地',
    enName: 'Arknights: Endfield',
    color: '#2EC4B6',
    accent: '#8FE6DC',
    glow: 'rgba(46,196,182,0.45)',
    cadence: { weeks: 6, weekday: 4, hour: 10, minute: 0 },
    keywords: ['终末地', '塔卫二', '终末地工业', '协议核心', '深层协议', '管理员'],
    mark: '终'
  }
];

const GAME_MAP = Object.fromEntries(GAMES.map(g => [g.id, g]));

const CATEGORIES = [
  { id: 'version', name: '版本', color: '#7FD1FF' },
  { id: 'activity', name: '活动', color: '#FFD166' },
  { id: 'banner', name: '卡池', color: '#FF9EC4' },
  { id: 'maintenance', name: '维护', color: '#9AA5B1' },
  { id: 'deadline', name: '截止', color: '#FF5C5C' },
  { id: 'other', name: '其他', color: '#A0AEC0' }
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

function getGame(id) {
  return GAME_MAP[id] || null;
}

module.exports = { GAMES, GAME_MAP, CATEGORIES, CATEGORY_MAP, getGame };
