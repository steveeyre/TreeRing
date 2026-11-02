export const SEED_MEMBERS = [
  { name: '爸爸', emoji: '👨', color: '#4A90E2', sort_order: 0 },
  { name: '妈妈', emoji: '👩', color: '#E05A8A', sort_order: 1 }
]

// 印记种子数据不再内置在此文件。
// 权威来源：data/footprints.md（用户提供的「孩子未来要做的 300 件事」清单）。
// 在 PC 端编辑该文件后，运行 scripts/sync-footprints.mjs 把印记同步到 Workers + D1，
// App 通过 useMilestones() 直接读取，不再在首次登录时写死种子印记。
// 用法：npm run footprints:dry / npm run footprints:sync
