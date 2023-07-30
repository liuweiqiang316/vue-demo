/**
 * 准备工作
 */

const bucket = new WeakMap();

export const ITERATE_KEY = Symbol();

export const TriggerType = {
  SET: "SET",
  ADD: "ADD",
  DELETE: "DELETE",
};

const cleanup = (effectFn) => {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i];
    deps.delete(effectFn);
  }
  effectFn.deps.length = 0;
};

let activeEffect;
// effect 栈
const effectStack = [];

export const effect = (fn, options = {}) => {
  const effectFn = () => {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStack.push(effectFn);
    const res = fn();
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    return res;
  };
  effectFn.options = options;
  effectFn.deps = [];
  if (!options.lazy) {
    effectFn();
  }
  return effectFn;
};

export const track = (target, key) => {
  if (!activeEffect) return;

  let despMap = bucket.get(target);
  if (!despMap) {
    bucket.set(target, (despMap = new Map()));
  }

  let deps = despMap.get(key);
  if (!deps) {
    despMap.set(key, (deps = new Set()));
  }

  deps.add(activeEffect);
  activeEffect.deps.push(deps);
};

export const trigger = (target, key, type, newVal) => {
  const despMap = bucket.get(target);
  if (!despMap) return;

  const effects = despMap.get(key);

  const effectsToRun = new Set();

  effects &&
    effects.forEach((effectFn) => {
      if (effectFn !== activeEffect) {
        effectsToRun.add(effectFn);
      }
    });

  if (type === TriggerType.ADD && Array.isArray(target)) {
    const lengthEffects = despMap.get("length");
    lengthEffects &&
      lengthEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  if (Array.isArray(target) && key === "length") {
    despMap.forEach((effects, key) => {
      if (key >= newVal) {
        effects.forEach((effecfn) => {
          if (effecfn !== activeEffect) {
            effectsToRun.add(effecfn);
          }
        });
      }
    });
  }

  if (type === TriggerType.ADD || type === TriggerType.DELETE) {
    const iterateEffects = despMap.get(ITERATE_KEY);
    iterateEffects &&
      iterateEffects.forEach((effectFn) => {
        if (!effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  effectsToRun.forEach((effectFn) => {
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn);
    } else {
      effectFn();
    }
  });
};

export const computed = (getter) => {
  let value;
  let dirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {
      if (!dirty) {
        dirty = true;
        trigger(obj, "value");
      }
    },
  });

  const obj = {
    get value() {
      if (dirty) {
        value = effectFn();
        dirty = false;
      }
      track(obj, "value");
      return value;
    },
  };

  return obj;
};

const traverse = (value, seen = new Set()) => {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const k in value) {
    traverse(value[k], seen);
  }
};

export const watch = (source, cb, options = {}) => {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;
  let cleanup;
  const onInvalidate = (fn) => {
    cleanup = fn;
  };

  const job = () => {
    newValue = effectFn();
    if (cleanup) {
      cleanup();
    }
    cb(newValue, oldValue, onInvalidate);
    oldValue = newValue;
  };

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler() {
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(job);
      } else {
        job();
      }
    },
  });

  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
};

const arrarInstrumentations = {};

["includes", "indexOf", "lastIndexOf"].forEach((method) => {
  const originMethod = Array.prototype[method];

  arrarInstrumentations[method] = function (...args) {
    let res = originMethod.apply(this, args);
    if (res === false || res === -1) {
      res = originMethod.apply(this.raw, args);
    }

    return res;
  };
});

const createReactive = (obj, isShallow = false, isReadonly = false) => {
  return new Proxy(obj, {
    get(target, key, receiver) {
      if (key === "raw") {
        return target;
      }

      if (Array.isArray(target) && arrarInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrarInstrumentations, key, receiver);
      }

      if (!isReadonly && typeof key !== "symbol") {
        track(target, key);
      }

      const res = Reflect.get(target, key, receiver);
      if (isShallow) return res;

      if (typeof res === "object" && res !== null) {
        return isReadonly ? readonly(res) : reactive(res);
      }

      return res;
    },
    set(target, key, newVal, receiver) {
      if (isReadonly) {
        console.warn(`属性 ${key} 是只读的`);
        return true;
      }
      const oldVal = target[key];
      const type = Array.isArray(target)
        ? Number(key) < target.length
          ? TriggerType.SET
          : TriggerType.ADD
        : Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.SET
        : TriggerType.ADD;

      const res = Reflect.set(target, key, newVal, receiver);

      // target === receiver.raw 说明 receiver 就是 target 的代理对象
      if (target === receiver.raw) {
        if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
          trigger(target, key, type, newVal);
        }
      }

      return res;
    },
    deleteProperty(target, key) {
      if (isReadonly) {
        console.warn(`属性 ${key} 是只读的`);
        return true;
      }
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const res = Reflect.deleteProperty(target, key);
      if (res && hadKey) {
        trigger(target, key, TriggerType.DELETE);
      }

      return res;
    },
    has(target, key) {
      track(target, key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      // track(target, ITERATE_KEY);
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
  });
};

const reactiveMap = new Map();

export const reactive = (obj) => {
  const existionProxy = reactiveMap.get(obj);
  if (existionProxy) return existionProxy;

  const proxy = createReactive(obj);
  reactiveMap.set(obj, proxy);

  return proxy;
};

export const shallowReactive = (obj) => {
  return createReactive(obj, true);
};

export const readonly = (obj) => {
  return createReactive(obj, false, true);
};

export const shallowReadonly = (obj) => {
  return createReactive(obj, true, true);
};
