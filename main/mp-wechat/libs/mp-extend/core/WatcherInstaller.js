import OptionInstaller from './OptionInstaller';
import {isFunction, isPlainObject, isPrimitive, isString} from "../utils/common";
import {Collectors, Stream} from "../libs/Stream";
import equal from "../libs/fast-deep-equal/index";
import {Invocation} from "../libs/Invocation";

const StaticWatchSign = Symbol('__wxSWatch__');
const DynamicWatchSign = Symbol('__wxDWatch__');

class CompatibleWatcher {
    _oldValue = [];
    _callback = undefined;
    _once = undefined;
    _immediate = false;
    _deep = false;
    _path = "";
    _getter = undefined;

    /**
     *
     * @param path - 使用 Vue格式
     * @param callback - 必须，自定义回调
     * @param once - 必须，初始化函数，传入初始值，仅执行一次
     * @param immediate - 非必须，仅标记作用，创建后是否立即执行，取决于once实现
     * @param deep - 深度监听
     * @param oldValue - 在call未调用完毕前为当前值
     * @param {function (...args):any} getter - 值生成器，自定义值的获取逻辑
     */
    constructor(path, callback, once, immediate, deep, oldValue = [], getter = null) {
        this._callback = callback;
        this._immediate = immediate;
        this._once = once;
        this._deep = deep;
        this._path = path;
        this._oldValue = oldValue;
        this._getter = getter;
    }

    call(thisArg, args) {
        if (this._callback) {
            this._callback.apply(thisArg, args.concat(this.oldValue));
        }
        this.oldValue = args;
    }

    once(thisArg, args) {
        if (this._once) {
            this._once.apply(thisArg, args.concat(this.oldValue));
            this.oldValue = args;
            this._once = undefined;
        }
    }

    update(thisArg) {
        if (this._getter) {
            this.call(thisArg, [this._getter.call(thisArg)]);
        }
    }

    get immediate() {
        return this._immediate;
    }

    set immediate(value) {
        this._immediate = value;
    }

    get deep() {
        return this._deep;
    }

    set deep(value) {
        this._deep = value;
    }

    get path() {
        return this._path;
    }

    set path(value) {
        this._path = value;
    }

    get oldValue() {
        return this._oldValue;
    }

    set oldValue(value) {
        this._oldValue = value;
    }

    get getter() {
        return this._getter;
    }

    set getter(value) {
        this._getter = value;
    }
}

/**
 * immediate - 拦截 mounted/attached 前置执行
 * deep - 加上 '.**' 后缀
 *
 * 对于 properties 默认值 与 查询串值同时存在时，created执行后会被查询串的值覆盖：
 * properties = { a:{ value:114,observer:ob1 } } , observers:{ a:ob2 }，同时页面传入page?a=514
 * 在 attached 执行前，在created取得的值是a=114，attached后取得的值变为a=514，并且触发ob1 (114=>514)  ,ob2(514)，优先级ob1>ob2
 * 并且 触发器触发时机在 created 与 attached 之间
 *
 * 由于小程序新增的 observers配置 并不会传入旧值，想要兼容Vue获取旧值并保存，可以拦截created获取旧值，此时的属性值还没有被查询串值覆盖
 * 并且created执行时所有侦听器还没有被执行，当侦听器执行时，可以顺利将传入的新值与旧值比对
 *
 */
export default class WatcherInstaller extends OptionInstaller {

    /**
     * Vue 形式侦听器格式只包含数字字母下划线和点运算符
     * @param data
     * @param path
     * @returns {any|undefined}
     */
    selectData(data, path) {
        if (!path) {
            return undefined;
        }
        if (!/[\w\.]+/.test(path)) {
            throw new Error(`Failed watching path: "${path}" Watcher only accepts simple dot-delimited paths. For full control, use a function instead.`);
        }
        if ((data === null || data === undefined || isPrimitive(data)) && path) {
            return undefined;
        }
        const iDot = path.indexOf('.');
        const prop = path.substring(0, iDot < 0 ? path.length : iDot);
        const right = path.substring(prop.length + 1);
        if (!right) {
            return Reflect.get(data, prop);
        } else {
            return this.selectData(Reflect.get(data, prop), right);
        }
    }

    selectPathRoot(path) {
        const v = /^[\w]+/.exec(path);
        if (v) {
            return v[0];
        }
        const d = /^\[(\d+)\]+/.exec(path);
        if (d) {
            return d[1];
        }
        const i = /^\.(\d+)/.exec(path);
        if (i) {
            return i[1];
        }
        return null;
    }

    shallowCopyObject(obj, path, assignment) {
        let root;
        let pathRight = path;
        let rootVal = obj;
        while ((root = this.selectPathRoot(pathRight)) !== null) {
            const tryNum = Number.parseInt(root);
            if (Number.isSafeInteger(tryNum)) {
                rootVal = Reflect.get(rootVal, tryNum);
                assignment = Reflect.get(assignment, tryNum);
                if (pathRight[0] === '.') {
                    pathRight = pathRight.substring(root.length + 1);
                } else {
                    pathRight = pathRight.substring(root.length + 2);
                }
            } else {
                const val = Reflect.get(rootVal, root);
                if (!isPrimitive(val)) {
                    if (Array.isArray(val)) {
                        assignment[root] = val.concat([]);
                    } else {
                        Reflect.set(assignment, root, val);
                    }
                } else {
                    Reflect.set(assignment, root, val);
                }
                rootVal = val;
                assignment = assignment[root];
                pathRight = pathRight.substring(root.length);
            }
        }

        const nextPath = pathRight.replace(/^\./, '');
        if (nextPath) {
            return this.shallowCopyObject(rootVal, nextPath, assignment);
        }
        return rootVal;
    }

    /**
     * 转换Vue的格式为小程序格式
     * @param rule
     * @returns {*}
     */
    transformToObserverField(rule) {
        return rule.replace(/\.(\d+)/g, function () {
            return `[${arguments[1]}]`;
        });
    }

    getStaticWatcher(thisArg, path) {
        return Reflect.get(thisArg, StaticWatchSign).get(path);
    }

    getDynamicWatchers(thisArg) {
        return Reflect.get(thisArg, DynamicWatchSign);
    }

    dynamicWatchersDefinition(thisArg) {
        const selectRuntimeState = (data, path) => {
            return this.selectData(data, path);
        };

        if (!Object.hasOwnProperty.call(thisArg, '$watch')) {
            const $watch = function (expOrFn, callback, options) {
                if (isFunction(expOrFn)) {
                    const watcher = new CompatibleWatcher(
                        undefined,
                        function (newValue, oldValue) {
                            if (!equal(newValue, oldValue)) {
                                callback.call(this, newValue, oldValue);
                            }
                        },
                        function (newValue, oldValue) {
                            if (watcher.immediate) {
                                callback.call(this, newValue, oldValue);
                            }
                        },
                        options && options.immediate === true,
                        true,
                        undefined,
                        function () {
                            return expOrFn.call(this);
                        }
                    );
                    watcher.once(thisArg, [expOrFn.call(thisArg)]);
                    Reflect.get(thisArg, DynamicWatchSign).set(
                        Symbol('expOrFn'),
                        watcher
                    );
                } else if (isString(expOrFn)) {
                    const watcher = new CompatibleWatcher(
                        expOrFn,
                        function (newValue, oldValue) {
                            if (!equal(newValue, oldValue)) {
                                callback.call(this, newValue, oldValue);
                            }
                        },
                        function (newValue, oldValue) {
                            if (watcher.immediate) {
                                callback.call(this, newValue, oldValue);
                            }
                        },
                        options && options.immediate === true,
                        true,
                        undefined
                    );
                    watcher.once(thisArg, [selectRuntimeState(thisArg.data, expOrFn)]);
                    Reflect.get(thisArg, DynamicWatchSign).set(
                        Symbol('expOrFn'),
                        watcher
                    );
                } else {
                    throw new Error(`"${expOrFn}" is neither a string nor a function.`);
                }
            };

            Object.defineProperty(thisArg, '$watch', {
                configurable: false,
                enumerable: false,
                get() {
                    return $watch;
                }
            })
        }
    }

    /**
     * 对于静态监听器，编译期间便可确定旧值
     * @param extender
     * @param context
     * @param options
     * @param defFields
     */
    staticWatchersDefinition(extender, context, options, defFields) {
        const watch = context.get('watch');
        const observers = context.get('observers');

        const staticWatchers = new Map();

        Object.entries(watch).forEach(([path, watchers]) => {
            const observerPath = this.transformToObserverField(path);

            const deepWatchers = watchers.filter(w => w.deep === true);
            const shallowWatchers = watchers.filter(w => w.deep !== true);

            if (deepWatchers.length) {
                staticWatchers.set(`${observerPath}.**`, new CompatibleWatcher(
                    path,
                    function (newValue, oldValue) {
                        if (!equal(newValue, oldValue)) {
                            deepWatchers.forEach(w => {
                                w.handler.call(this, newValue, oldValue);
                            });
                        }
                    },
                    function (newValue, oldValue) {
                        deepWatchers.forEach(w => {
                            if (w.immediate === true) {
                                w.handler.call(this, newValue, oldValue);
                            }
                        });
                    }, true, true, undefined));
            }

            if (shallowWatchers.length) {
                staticWatchers.set(observerPath, new CompatibleWatcher(
                    path,
                    function (newValue, oldValue) {
                        if (!equal(newValue, oldValue)) {
                            shallowWatchers.forEach(w => {
                                w.handler.call(this, newValue, oldValue);
                            });
                        }
                    },
                    function (newValue, oldValue) {
                        shallowWatchers.forEach(w => {
                            if (w.immediate === true) {
                                w.handler.call(this, newValue, oldValue);
                            }
                        });
                    }, true, false, undefined));
            }
        });

        const createStaticWatchers = () => {
            return staticWatchers;
        };

        const getStaticWatcher = (thisArg, path) => {
            return this.getStaticWatcher(thisArg, path);
        };

        const selectRuntimeState = (data, path) => {
            const assigment = {};
            return this.shallowCopyObject(data, path, assigment);
        };

        console.log(staticWatchers)

        const behavior = {
            lifetimes: {
                created() {
                    Object.defineProperty(this, StaticWatchSign, {
                        configurable: false,
                        enumerable: false,
                        value: createStaticWatchers(),
                        writable: false
                    });

                    Object.defineProperty(this, DynamicWatchSign, {
                        configurable: false,
                        enumerable: false,
                        value: new Map(),
                        writable: false
                    });

                    for (const observerPath of staticWatchers.keys()) {
                        const watcher = getStaticWatcher(this, observerPath);
                        if (watcher) {
                            const curValue = selectRuntimeState(this.data, watcher.path);

                            // 设置侦听器初始值，并触发 immediate 侦听器
                            watcher.once(this, [curValue]);
                        }
                    }
                }
            },
            observers: Stream.of(
                [...new Set(
                    [
                        ...Object.keys(observers),
                        ...staticWatchers.keys()
                    ]
                )].map((observerPath) => {
                    return [
                        observerPath,
                        Invocation(observers[observerPath], null, function (newValue) {
                            const watcher = getStaticWatcher(this, observerPath);
                            if (watcher) {
                                watcher.call(this, [newValue])
                            }
                        })
                    ];
                })
            ).collect(Collectors.toMap())
        };

        defFields.behaviors = [Behavior(behavior)].concat((defFields.behaviors || []));
    }

    definitionFilter(extender, context, options, defFields, definitionFilterArr) {
        const watch = context.get('watch');
        const state = context.get('state');
        const observers = context.get('observers');

        if (state && watch && (Object.keys(watch).length || Object.keys(observers).length)) {
            this.staticWatchersDefinition(extender, context, options, defFields);
        }
    }

    lifetimes(extender, context, options) {
        const injectDynamicWatchers = (thisArg) => {
            this.dynamicWatchersDefinition(thisArg);
        };

        return {
            created() {
                injectDynamicWatchers(this);
            }
        };
    }

    /**
     * 统一 Vue 格式的侦听器
     * @param extender
     * @param context
     * @param options
     */
    install(extender, context, options) {
        const getDynamicWatchers = (thisArg) => {
            return this.getDynamicWatchers(thisArg);
        };

        const selectRuntimeState = (data, path) => {
            return this.selectData(data, path);
        };

        const watch = Stream.of(
            Object.entries(
                Object.assign.apply(
                    undefined,
                    [
                        {},
                        ...extender.installers.map(i => i.watch()),
                        options.watch
                    ]
                )
            )
        ).map(([path, watcher]) => {
            return [
                path,
                [].concat(watcher).map(w => {
                    const normalize = {
                        handler: null,
                        deep: false,
                        immediate: false
                    };
                    if (isString(w)) {
                        normalize.handler = function () {
                            const method = this[w];
                            if (isFunction(method)) {
                                method.apply(this, arguments);
                            }
                        };
                    } else if (isFunction(w)) {
                        normalize.handler = w;
                    } else if (isPlainObject(w)) {
                        const {immediate, deep, handler} = w;
                        normalize.immediate = immediate === true;
                        normalize.deep = deep === true;
                        normalize.handler = isFunction(handler) ? handler : function () {
                            const method = this[handler];
                            if (isFunction(method)) {
                                method.apply(this, arguments);
                            }
                        };
                    }
                    return normalize;
                }).filter(w => isFunction(w.handler))
            ];
        }).filter(([, watchers]) => watchers.length > 0).collect(Collectors.toMap());

        const observers = Object.assign.apply(
            undefined,
            [
                {},
                ...extender.installers.map(i => i.observers()),
                options.observers
            ]
        );

        Object.assign(observers, {
            '**': Invocation(observers['**'], null, function () {
                const watchers = getDynamicWatchers(this);
                if (watchers.size) {
                    for (const [, watcher] of watchers) {
                        if (!watcher.path) {
                            watcher.update(this);
                        } else {
                            const newValue = selectRuntimeState(this.data, watcher.path);
                            watcher.call(this, [newValue]);
                        }
                    }
                }
            })
        });

        context.set('watch', watch);
        context.set('observers', observers);
    }
}