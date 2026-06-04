import { BigBangLogo } from "./BigBangLogo";
import { ThinkingAnimation, type ThinkingAnimationVariant } from "./ThinkingAnimation";

type DemoItem = {
  variant: ThinkingAnimationVariant;
  title: string;
  description: string;
};

const DEMOS: DemoItem[] = [
  {
    variant: "coreloop",
    title: "A. 最终候选：去竖线版",
    description: "基于宇宙大爆炸版，同时删除射出去的线和单条竖线；已增强小尺寸下由静到动的反差。",
  },
  {
    variant: "loop",
    title: "B. 大爆炸去线版",
    description: "严格基于宇宙大爆炸版，只删除射出去的线；核心、竖线、圆形膨胀和压缩节奏都不改。",
  },
  {
    variant: "bigbang",
    title: "C. 宇宙大爆炸",
    description: "一个点 → 一条竖线 → 多条直线径向射出，射出时尾部消散 → 点膨胀成圆 → 圆被压扁成点。当前备份版。",
  },
  {
    variant: "blackhole",
    title: "D. 黑洞坍缩",
    description: "从奇点进入吸积盘/事件视界的感觉：线条不向外炸开，而是被旋转吞入，最后压回核心。",
  },
  {
    variant: "burst",
    title: "E. 爆炸线重做",
    description: "保留爆炸线方向，但让线头更锐、射出更短促，尾部在飞行过程中被快速吃掉。",
  },
  {
    variant: "collapse",
    title: "F. 标准节奏",
    description: "同一套动作，散射距离略收敛，适合聊天区里更克制的思考状态。",
  },
  {
    variant: "slow",
    title: "G. 慢速膨胀",
    description: "整体更慢，奇点、竖线、散射和圆形膨胀几个阶段更容易看清。",
  },
  {
    variant: "sharp",
    title: "H. 快速爆发",
    description: "节奏更紧，竖线拉伸和散射更像瞬间爆发，张力最集中。",
  },
  {
    variant: "wide",
    title: "I. 大范围散射",
    description: "多条直线向外飞得更远，宇宙扩张感更明显。",
  },
];

export function ThinkingAnimationLab() {
  return (
    <main className="thinking-lab">
      <section className="thinking-lab-hero">
        <p className="thinking-lab-kicker">Thinking animation preview</p>
        <h1>宇宙大爆炸思考动画</h1>
        <p>当前 A 版作为最终候选：基于宇宙大爆炸版，删除散射线和单条竖线，并为 agent 里的小尺寸显示强化了静到动、膨胀到坍缩的反差。</p>
        <div className="thinking-logo-preview" aria-label="Logo 预览">
          <BigBangLogo size={72} title="大爆炸坍缩瞬间 Logo" />
          <div>
            <strong>Logo 静态帧</strong>
            <span>单个坍缩核心的达芬奇式素描帧：保留手绘线稿和排线，不再添加旁侧圆形</span>
            <code>/assets/bigbang-logo.svg</code>
          </div>
        </div>
      </section>

      <section className="thinking-lab-grid" aria-label="思考动画版本预览">
        {DEMOS.map((demo) => (
          <article className="thinking-lab-card" key={demo.variant}>
            <div className="thinking-lab-stage">
              <ThinkingAnimation variant={demo.variant} size={82} />
            </div>
            <div className="thinking-lab-copy">
              <div className="thinking-lab-card-title-row">
                <h2>{demo.title}</h2>
              </div>
              <p>{demo.description}</p>
              <code>{`variant="${demo.variant}"`}</code>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
