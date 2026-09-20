import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, FlowState } from '../types';
import { createInitialState, reducer } from './engine';

const STORAGE_KEY = 'signflow.state.v1';
const HISTORY_LIMIT = 200;

interface Stack {
  past: FlowState[];
  present: FlowState;
  future: FlowState[];
}

function isFlowState(x: unknown): x is FlowState {
  if (!x || typeof x !== 'object') return false;
  const s = x as FlowState;
  return (
    typeof s.clock === 'number' &&
    Array.isArray(s.runs) &&
    Array.isArray(s.versions) &&
    typeof s.currentFingerprint === 'string'
  );
}

function loadPersisted(): Stack | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stack;
    if (!isFlowState(parsed.present)) return null;
    if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future)) return null;
    if (!parsed.past.every(isFlowState) || !parsed.future.every(isFlowState)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface FlowStore {
  state: FlowState;
  act: (action: Action) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
  loadState: (state: FlowState) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
}

export function useFlowStore(): FlowStore {
  const [stack, setStack] = useState<Stack>(() => {
    const restored = loadPersisted();
    return restored ?? { past: [], present: createInitialState(), future: [] };
  });
  const [playing, setPlaying] = useState(false);
  const skipPersist = useRef(false);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
    } catch {
      // 存储满或被禁用时不影响演练
    }
  }, [stack]);

  const act = useCallback((action: Action) => {
    setStack((prev) => {
      if (action.type === 'LOAD' || action.type === 'RESET') return prev;
      const next = reducer(prev.present, action);
      if (next === prev.present) return prev;
      const past = [...prev.past, prev.present];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { past, present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setStack((prev) => {
      if (prev.past.length === 0) return prev;
      const past = [...prev.past];
      const present = past.pop()!;
      return { past, present, future: [prev.present, ...prev.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setStack((prev) => {
      if (prev.future.length === 0) return prev;
      const future = [...prev.future];
      const present = future.shift()!;
      return { past: [...prev.past, prev.present], present, future };
    });
  }, []);

  const reset = useCallback(() => {
    skipPersist.current = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setStack({ past: [], present: createInitialState(), future: [] });
    setPlaying(false);
  }, []);

  const loadState = useCallback((state: FlowState) => {
    // 场景回放载入：整体替换画布，不进撤销栈
    setStack({ past: [], present: state, future: [] });
  }, []);

  // 自动播放：每个虚拟步 1.2 秒
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStack((prev) => {
        const next = reducer(prev.present, { type: 'TICK' });
        const past = [...prev.past, prev.present];
        if (past.length > HISTORY_LIMIT) past.shift();
        return { past, present: next, future: [] };
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [playing]);

  // 流程终止且队列清空时自动暂停
  useEffect(() => {
    if (playing && !stack.present.activeRunId && stack.present.queue.length === 0) {
      setPlaying(false);
    }
  }, [playing, stack.present.activeRunId, stack.present.queue.length]);

  // 键盘快捷键：空格单步、Ctrl/Cmd+Z 撤销、Ctrl+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        act({ type: 'TICK' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, undo, redo]);

  return useMemo(
    () => ({
      state: stack.present,
      act,
      undo,
      redo,
      canUndo: stack.past.length > 0,
      canRedo: stack.future.length > 0,
      reset,
      loadState,
      playing,
      setPlaying,
    }),
    [stack, act, undo, redo, reset, loadState, playing],
  );
}
