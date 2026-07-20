/* ═══════════════════════════════════════════════════════════
   practice_matches.js — 手动输入的练习赛比赛结果
   ═══════════════════════════════════════════════════════════

   这些数据会被 GoatPredict 用于 EPA/OPR 计算和排名预测，
   特别是在正式资格赛赛程未发布或刚开始时。

   ── 2026 赛季 Ranking Points 规则 ──
   每场资格赛（含练习赛预测参考）队伍最多可获得 4 个 RP:
     · 胜利: 2 RP（赢方）/ 0 RP（输方）/ 1 RP（平局）
     · rp1:  fuel 净得分 >= 240  → 1 bonus RP
     · rp2:  fuel 净得分 >= 360  → 1 bonus RP

   ── 每场比赛字段说明 ──
   {
     num:       比赛编号（1, 2, 3, ...）,
     red:       [红方队伍号1, 队伍号2, 队伍号3],
     blue:      [蓝方队伍号1, 队伍号2, 队伍号3],
     redScore:  红方总分,
     blueScore: 蓝方总分,
     redAuto:   红方自动分（可选，用于细化 EPA）,
     blueAuto:  蓝方自动分（可选）,
     redRP:     [rp1_达成?, rp2_达成?],   // 两个 booleans
     blueRP:    [rp1_达成?, rp2_达成?],
   }

   ── 使用方法 ──
   练习赛打完后，在下方对应 event_key 的数组中添加一条记录。
   保存文件后推送，GoatPredict 会自动加载并用于预测。
   ═══════════════════════════════════════════════════════════ */

const PRACTICE_MATCHES = {
    '2026cnsanya': [
        // ── 练习赛 1 ──
        {
            num: 1,
            red:  [6907, 8011, 5522],
            blue: [2231, 8044, 5451],
            redScore:  0,
            blueScore: 0,
            redAuto:   0,
            blueAuto:  0,
            redRP:  [false, false],
            blueRP: [false, false],
        },
        // ── 练习赛 2 ──
        // {
        //     num: 2,
        //     red:  [6907, 8011, 5522],
        //     blue: [2231, 8044, 5451],
        //     redScore:  0,
        //     blueScore: 0,
        //     redAuto:   0,
        //     blueAuto:  0,
        //     redRP:  [false, false],
        //     blueRP: [false, false],
        // },
    ],
};
