import OptionInstaller from "./OptionInstaller";
import {isFunction, isPlainObject} from "../utils/common";
import {Collectors, Stream} from "../libs/Stream";
import {Singleton} from "../libs/Singleton";
import equal from "../libs/fast-deep-equal/index";

const RTCSign = Symbol("__wxRTC__");
const CMPCSign = Symbol("__wxCMPC__");
const CMPCSetterSign = Symbol("__wxCMPC_SETTER__");
const CMPCGetterSign = Symbol("__wxCMPC_GETTER__");

class ComputedSourceSingleton extends Singleton {
    _source = undefined;

    get source() {
        return this._source;
    }

    set source(value) {
        this._source = value;
    }

    constructor() {
        super((runtimeContext) => {
            const self = this;
            return new Proxy(runtimeContext, {
                get(target, p, receiver) {
                    if (isPlainObject(self.source) && Reflect.has(self.source, p)) {
                        return Reflect.get(self.source, p);
                    }
                    return Reflect.get(target, p);
                },
                set(target, p, value, receiver) {
                    return Reflect.set(target, p, value);
                }
            });
        });
    }

    get(runtimeContext, source) {
        this.source = source;
        return super.get(runtimeContext);
    }
}

/**
 * 为防止闭环，计算属性初始化在data,props初始化之后
 */
export default class ComputedInstaller extends OptionInstaller {
    getRuntimeContext(thisArg, context, fnSetData) {
        if (Reflect.has(thisArg, RTCSign)) {
            return Reflect.get(thisArg, RTCSign).get(thisArg, context.get("properties"), context.get("computed"), fnSetData);
        }
        return thisArg;
    }

    releaseRuntimeContext(thisArg) {
        if (Reflect.has(thisArg, RTCSign)) {
            Reflect.get(thisArg, RTCSign).release();
            Reflect.deleteProperty(this, RTCSign);
        }
    }

    getComputedContext(thisArg, context, fnSetData, source) {
        return Reflect.get(thisArg, CMPCSign).get(this.getRuntimeContext(thisArg, context, fnSetData), source);
    }

    releaseComputedContext(thisArg) {
        if (Reflect.has(thisArg, CMPCSign)) {
            Reflect.get(thisArg, CMPCSign).release();
            Reflect.deleteProperty(this, CMPCSign);
        }
    }

    attemptToInstantiateCalculated(extender, context, options, defFields, definitionFilterArr) {
        const computed = context.get("computed");
        const methods = context.get("methods");
        const state = Object.assign({}, context.get("state")); // 复制结果集，避免修改原值

        const computedContext = new Proxy(
            {},
            {
                get(target, p, receiver) {
                    if (Reflect.has(state, p)) {
                        return Reflect.get(state, p);
                    }
                    if (Reflect.has(computed, p)) {
                        const expr = Reflect.get(computed, p);
                        if (isFunction(expr)) {
                            return expr.call(receiver);
                        } else if (isPlainObject(expr) && isFunction(expr.get)) {
                            return (expr.get).call(receiver);
                        } else if (Reflect.has(methods, p)) {
                            const method = Reflect.get(methods, p);
                            if (isFunction(method)) {
                                return method.bind(receiver);
                            }
                        }
                    }
                    return undefined;
                }
            }
        );

        return Stream.of(Object.entries(computed)).map(([name, calc]) => {
            const expr = isPlainObject(calc) && isFunction(calc.get) ? calc.get : (isFunction(calc) ? calc : null);
            if (isFunction(expr)) {
                return [name, expr.call(computedContext)];
            }
            return undefined;
        }).filter(i => !!i).collect(Collectors.toMap());
    }

    beforeUpdate(extender, context, options, instance, data) {
        const computed = context.get("computed");
        const setters = Reflect.get(instance, CMPCSetterSign);
        const getters = Reflect.get(instance, CMPCGetterSign);

        const setterIncludes = Object.keys(data).filter(i => setters.includes(i));

        const originalSetData = instance.setData;

        // setData数据是否包含计算属性，调用对应的setter触发器
        if (setterIncludes.length) {
            setterIncludes.forEach((i) => {
                (computed[i].set).call(
                    this.getRuntimeContext(instance, context, originalSetData.bind(instance)),
                    data[i]
                );
            });
        }

        // 刷新计算属性的值
        const nextCalculated = {};
        getters.forEach((p) => {
            const getter = isFunction(computed[p].get) ? computed[p].get : computed[p];
            // 获取当前值
            const curVal = Reflect.get(this.getRuntimeContext(instance, context, originalSetData.bind(instance)), p);

            // 计算下一个值
            const pValue = getter.call(
                this.getComputedContext(
                    instance,
                    context,
                    originalSetData.bind(instance),
                    data
                )
            );

            // 深度比较，必须，否则会死循环
            if (!equal(curVal, pValue)) {
                nextCalculated[p] = pValue;
            }
        });

        // 合并新的计算属性值到data中
        Object.assign(data, nextCalculated);
    }

    definitionFilter(extender, context, options, defFields, definitionFilterArr) {
        const state = context.get("state");
        const computed = context.get("computed");

        const setters = Object.keys(computed).filter(i => isPlainObject(computed[i]) && isFunction(computed[i].set));
        const getters = isPlainObject(computed) ? Object.keys(computed).filter(i => (isPlainObject(computed[i]) && isFunction(computed[i].get)) || isFunction(computed[i])) : [];

        // 检查是否安装StateInstaller
        if (isPlainObject(state)) {
            const calculated = this.attemptToInstantiateCalculated(extender, context, options, defFields, definitionFilterArr);

            const createContext = () => {
                return extender.createRuntimeContextSingleton();
            };

            const releaseContext = (thisArg) => {
                this.releaseRuntimeContext(thisArg);
            };

            const createCMPC = (thisArg) => {
                Object.defineProperty(thisArg, CMPCGetterSign, {
                    value: getters,
                    enumerable: false,
                    configurable: false
                });
                Object.defineProperty(thisArg, CMPCSetterSign, {
                    value: setters,
                    enumerable: false,
                    configurable: false
                });
                return new ComputedSourceSingleton();
            };

            const releaseCMPC = (thisArg) => {
                this.releaseComputedContext(thisArg);
                Reflect.deleteProperty(thisArg, CMPCGetterSign);
                Reflect.deleteProperty(thisArg, CMPCSetterSign);
            };

            defFields.behaviors = [
                Behavior({
                    data: calculated,
                    lifetimes: {
                        created() {
                            Object.defineProperty(this, RTCSign, {
                                configurable: false,
                                enumerable: false,
                                value: createContext(),
                                writable: false
                            });
                            Object.defineProperty(this, CMPCSign, {
                                configurable: false,
                                enumerable: false,
                                value: createCMPC(this),
                                writable: false
                            });
                        }
                    }
                })
            ].concat(
                (defFields.behaviors || []),
                Behavior({
                    lifetimes: {
                        detached() {
                            releaseContext(this);
                            releaseCMPC(this);
                        }
                    }
                })
            );
        }
    }

    install(extender, context, options) {
        const {computed = null} = options;
        context.set("computed", Object.assign.apply(
            undefined,
            [
                {},
                ...extender.installers.map(i => i.computed()),
                computed
            ]
        ));
    }
}