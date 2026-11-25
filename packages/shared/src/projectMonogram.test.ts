import { describe, expect, it } from "vite-plus/test";

import { projectMonogram } from "./projectMonogram.ts";

describe("projectMonogram", () => {
  it("produces readable acronyms for multi-word Latin and hyphenated names", () => {
    expect(projectMonogram("t3-code")).toBe("T3");
    expect(projectMonogram("ECS-infra")).toBe("ECS");
    expect(projectMonogram("llm-bench")).toBe("LLM");
    expect(projectMonogram("fgo-agent")).toBe("FGO");
    expect(projectMonogram("maa-agent")).toBe("MAA");
    expect(projectMonogram("oh-my-pi")).toBe("OMP");
    expect(projectMonogram("vircs-construction-phase-ii")).toBe("CP2");
    expect(projectMonogram("vircs-ai-drama-studio")).toBe("ADS");
    expect(projectMonogram("enterprise-resource")).toBe("ER");
    expect(projectMonogram("OpenLess")).toBe("OL");
    expect(projectMonogram("Auto Monogram")).toBe("AM");
    expect(projectMonogram("web2 app")).toBe("W2");
    expect(projectMonogram("Paseo")).toBe("PA");
    expect(projectMonogram("Café Ünïcode")).toBe("CÜ");
  });

  it("uses up to two clear characters for CJK names", () => {
    expect(projectMonogram("事件中枢")).toBe("事件");
    expect(projectMonogram("健康顾问")).toBe("健康");
    expect(projectMonogram("定时任务与编排")).toBe("定时");
    expect(projectMonogram("ひらがな")).toBe("ひら");
    expect(projectMonogram("カタカナ")).toBe("カタ");
    expect(projectMonogram("건강 상담")).toBe("건강");
    expect(projectMonogram("〆切管理")).toBe("〆切");
  });

  it("normalizes width and keeps supplementary ideographs whole", () => {
    expect(projectMonogram("ｶﾞﾅ")).toBe("ガナ");
    expect(projectMonogram("𠮷野家")).toBe("𠮷野");
  });

  it("prefers meaningful CJK phrases over awkward mixed Latin+CJK pairs", () => {
    expect(projectMonogram("Documents & Downloads (历史归档)")).toBe("历史");
    expect(projectMonogram("健康App")).toBe("健康");
    expect(projectMonogram("  健康 Paseo")).toBe("健康");
    expect(projectMonogram("Paseo 健康")).toBe("健康");
    expect(projectMonogram("AI助手")).toBe("助手");
  });

  it("falls back when the name has no letters or digits", () => {
    expect(projectMonogram("")).toBe("PR");
    expect(projectMonogram("—")).toBe("PR");
  });
});
