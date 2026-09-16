'use client';
/**
 * 演示本地态：用户手操作产生的会话状态（追加提问、流式、反馈、代拟首问、引用、模型）。
 * 与剧本时间线分离——时间线只负责自动播放，这里的改动不会被播放 tick 冲掉。
 * 剧本切换由上层 key 重挂载（hero-demo 的 DemoPlayer key）负责归零，本 hook 不做 effect 同步。
 */
import {useMemo, useState } from "react";
import type { Scenario } from "@/constants/landing-demo";
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/models";

const STREAM_MS = 1400;
const REPLAY_MS = 1200;

export interface DemoLaneState {
  extraQuestions: string[];
  streaming: boolean;
  feedback: "positive" | "negative" | null;
  prefill: string | null;
  quote: string | null;
}

export interface DemoLocalState {
  lanes: DemoLaneState[];
  modelId: string;
}

function emptyLane(): DemoLaneState {
  return { extraQuestions: [], streaming: false, feedback: null, prefill: null, quote: null };
}

function initialLocalState(scenario: Scenario): DemoLocalState {
  return { lanes: scenario.lanes.map(() => emptyLane()), modelId: DEFAULT_THREAD_CHAT_MODEL_ID };
}

export interface DemoLocalApi {
  sendQuestion: (laneIndex: number, question: string) => void;
  finishStream: (laneIndex: number) => void;
  replayLane: (laneIndex: number) => void;
  setFeedback: (laneIndex: number, feedback: "positive" | "negative" | null) => void;
  setPrefill: (laneIndex: number, prefill: string | null) => void;
  setQuote: (laneIndex: number, quote: string | null) => void;
  setModel: (modelId: string) => void;
  reset: () => void;
}

export function useDemoLocalState(scenario: Scenario): { state: DemoLocalState; api: DemoLocalApi } {
  const [state, setState] = useState<DemoLocalState>(() => initialLocalState(scenario));

  const api = useMemo<DemoLocalApi>(() => {
    const patchLane = (laneIndex: number, patch: (lane: DemoLaneState) => DemoLaneState) => {
      setState((previous) => ({
        ...previous,
        lanes: previous.lanes.map((lane, index) => (index === laneIndex ? patch(lane) : lane)),
      }));
    };
    const stopStreamingLater = (laneIndex: number, delay: number) => {
      window.setTimeout(() => patchLane(laneIndex, (lane) => ({ ...lane, streaming: false })), delay);
    };
    return {
      sendQuestion(laneIndex, question) {
        patchLane(laneIndex, (lane) => ({
          ...lane,
          extraQuestions: [...lane.extraQuestions, question],
          streaming: true,
          prefill: null,
        }));
        stopStreamingLater(laneIndex, STREAM_MS);
      },
      finishStream(laneIndex) {
        patchLane(laneIndex, (lane) => ({ ...lane, streaming: false }));
      },
      replayLane(laneIndex) {
        patchLane(laneIndex, (lane) => ({ ...lane, streaming: true }));
        stopStreamingLater(laneIndex, REPLAY_MS);
      },
      setFeedback(laneIndex, feedback) {
        patchLane(laneIndex, (lane) => ({ ...lane, feedback }));
      },
      setPrefill(laneIndex, prefill) {
        patchLane(laneIndex, (lane) => ({ ...lane, prefill }));
      },
      setQuote(laneIndex, quote) {
        patchLane(laneIndex, (lane) => ({ ...lane, quote }));
      },
      setModel(modelId) {
        setState((previous) => ({ ...previous, modelId }));
      },
      reset() {
        setState(initialLocalState(scenario));
      },
    };
  }, [scenario]);

  return { state, api };
}
