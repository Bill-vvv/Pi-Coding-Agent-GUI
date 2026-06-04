import { ThinkingAnimation, type ThinkingAnimationVariant } from "./ThinkingAnimation";

type DemoItem = {
  variant: ThinkingAnimationVariant;
  title: string;
  description: string;
};

const DEMOS: DemoItem[] = [
  {
    variant: "bigbang",
    title: "A. 宇宙大爆炸",
    description: "一个点 → 一条竖线 → 多条直线径向射出，射出时尾部消散 → 点膨胀成圆 → 圆被压扁成点。默认候选。"
  },
  {
    variant: "collapse",
    title: "B. 标准节奏",
    description: "同一套动作，散射距离略收敛，适合聊天区里更克制的思考状态。",
  },
  {
    variant: "slow",
    title: "C. 慢速膨胀",
    description: "整体更慢，奇点、竖线、散射和圆形膨胀几个阶段更容易看清。",
  },
  {
    variant: "sharp",
    title: "D. 快速爆发",
    description: "节奏更紧，竖线拉伸和散射更像瞬间爆发，张力最集中。",
  },
  {
    variant: "wide",
    title: "E. 大范围散射",
    description: "多条直线向外飞得更远，宇宙扩张感更明显。"
  },
];

export function ThinkingAnimationLab() {
  return (
    <main className="thinking-lab">
      <section className="thinking-lab-hero">
        <p className="thinking-lab-kicker">Thinking animation preview</p>
        <h1>宇宙大爆炸思考动画</h1>
        <p>新版本按宇宙大爆炸节奏制作：先是奇点，然后拉成一条竖线，随后多条直线沿不同方向射出，并在运动中从尾部消散；散射后重新形成核心，核心膨胀成圆，最后被压扁并坍缩回一个点。</p>
      </section>

      <section className="thinking-lab-grid" aria-label="思考动画版本预览">
        {DEMOS.map((demo) => (
          <article className="thinking-lab-card" key={demo.variant}>
            <div className="thinking-lab-stage">
              <ThinkingAnimation variant={demo.variant} size={82} label="Pi 正在思考…" />
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
