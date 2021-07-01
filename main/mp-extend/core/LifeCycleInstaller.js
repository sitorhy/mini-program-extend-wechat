import OptionInstaller from "./OptionInstaller";
import {isFunction} from "../utils/common";
import {Deconstruct} from "../libs/Deconstruct";
import {Invocation} from "../libs/Invocation";

/**
 * 专有生命周期 onLoad onShow 不在统合范畴，使用 pageLifetimes 代替
 * 专有声明周期 onLoad onShow onReady 在 Page 中使用不会与框架的 pageLifetimes 冲突
 * 优先级 Vue的生命周期 < Installer 生命周期
 */
export default class LifeCycleInstaller extends OptionInstaller {
    behaviorLifeCycleDefinition(extender, context, options, defFields) {
        const behavior = Deconstruct({}, {
            ready: () => {
                return function () {
                    context.get('ready').apply(this, arguments);
                };
            },
            moved: () => {
                return function () {
                    context.get('moved').apply(this, arguments);
                };
            },
            lifetimes: () => {
                return {
                    created: function () {
                        context.get('lifetimes').created.apply(this, arguments);
                    },
                    attached: function () {
                        context.get('lifetimes').attached.apply(this, arguments);
                    },
                    detached: function () {
                        context.get('lifetimes').detached.apply(this, arguments);
                    }
                };
            },
            pageLifetimes: () => {
                return {
                    show: function () {
                        context.get('pageLifetimes').show.apply(this, arguments);
                    },
                    hide: function () {
                        context.get('pageLifetimes').hide.apply(this, arguments);
                    },
                    resize: function () {
                        context.get('pageLifetimes').resize.apply(this, arguments);
                    }
                };
            }
        });

        defFields.behaviors = (defFields.behaviors || []).concat([
            Behavior(behavior)
        ]);
    }

    compatibleLifeCycleDefinition(extender, context, options, defFields) {
        const behavior = Deconstruct({}, {
            lifetimes: () => {
                return {
                    created: function () {
                        context.get('created').apply(this, arguments);
                        context.get('beforeMount').apply(this, arguments);
                    },
                    attached: function () {
                        context.get('mounted').apply(this, arguments);
                    },
                    detached: function () {
                        context.get('beforeDestroy').apply(this, arguments);
                        context.get('destroyed').apply(this, arguments);
                    }
                };
            }
        });

        defFields.behaviors = (defFields.behaviors || []).concat([
            Behavior(behavior)
        ]);
    }

    definitionFilter(extender, context, options, defFields) {
        this.behaviorLifeCycleDefinition(extender, context, options, defFields);
        this.compatibleLifeCycleDefinition(extender, context, options, defFields);
    }

    /**
     * 聚集Installer生命周期拦截
     * @param extender
     * @param context
     * @param options
     */
    installBehaviorLifeCycle(extender, context, options) {
        const lifetimes = extender.installers.map(i => i.lifetimes(extender, context, options)).filter(i => !!i);
        const pageLifetimes = extender.installers.map(i => i.pageLifetimes(extender, context, options)).filter(i => !!i);

        context.set("ready", (() => {
            const readyChain = extender.installers.map(i => i.ready);
            return function () {
                readyChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("moved", (() => {
            const movedChain = extender.installers.map(i => i.moved);
            return function () {
                movedChain.forEach(i => i.apply(this, arguments));
            }
        })());

        context.set("lifetimes", Deconstruct({}, {
            created: () => {
                const createdChain = lifetimes.map(i => i.created).concat(extender.installers.map(i => i.created)).filter(i => isFunction(i));
                return function () {
                    createdChain.forEach(i => i.apply(this, arguments));
                };
            },
            attached: () => {
                const attachedChain = lifetimes.map(i => i.attached).concat(extender.installers.map(i => i.attached)).filter(i => isFunction(i));
                return function () {
                    attachedChain.forEach(i => i.apply(this, arguments));
                };
            },
            detached: () => {
                const detachedChain = lifetimes.map(i => i.detached).concat(extender.installers.map(i => i.detached)).filter(i => isFunction(i));
                return function () {
                    detachedChain.forEach(i => i.apply(this, arguments));
                };
            }
        }));

        context.set("pageLifetimes", Deconstruct({}, {
            show: () => {
                const showChain = pageLifetimes.map(i => i.show).filter(i => isFunction(i));
                return function () {
                    showChain.forEach(i => i.apply(this, arguments));
                };
            },
            hide: () => {
                const hideChain = pageLifetimes.map(i => i.hide).filter(i => isFunction(i));
                return function () {
                    hideChain.forEach(i => i.apply(this, arguments));
                };
            },
            resize: () => {
                const resizeChain = pageLifetimes.map(i => i.resize).filter(i => isFunction(i));
                return function () {
                    resizeChain.forEach(i => i.apply(this, arguments));
                };
            }
        }));
    }

    /**
     * 聚集Installer Vue格式的生命周期拦截
     * @param extender
     * @param context
     * @param options
     */
    installCompatibleLifeCycle(extender, context, options) {
        context.set("beforeCreate", (() => {
            const beforeCreateChain = extender.installers.map(i => i.beforeCreate).filter(i => isFunction(i));
            return function () {
                beforeCreateChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("created", (() => {
            const createdChain = extender.installers.map(i => i.created).filter(i => isFunction(i));
            return function () {
                createdChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("beforeMount", (() => {
            const beforeMountChain = extender.installers.map(i => i.beforeMount).filter(i => isFunction(i));
            return function () {
                beforeMountChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("mounted", (() => {
            const mountedChain = extender.installers.map(i => i.mounted).filter(i => isFunction(i));
            return function () {
                mountedChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("beforeDestroy", (() => {
            const beforeDestroyChain = extender.installers.map(i => i.beforeDestroy).filter(i => isFunction(i));
            return function () {
                beforeDestroyChain.forEach(i => i.apply(this, arguments));
            };
        })());

        context.set("destroyed", (() => {
            const destroyedChain = extender.installers.map(i => i.destroyed).filter(i => isFunction(i));
            return function () {
                destroyedChain.forEach(i => i.apply(this, arguments));
            };
        })());
    }

    installOptionsLifeCycle(extender, context, options) {
        context.set("beforeCreate", (() => {
            const {beforeCreate} = options;
            return Invocation(context.get('beforeCreate'), null, beforeCreate);
        })());

        context.set("created", (() => {
            const {created} = options;
            return Invocation(context.get('created'), null, created);
        })());

        context.set("beforeMount", (() => {
            const {beforeMount} = options;
            return Invocation(context.get('beforeMount'), null, beforeMount);
        })());

        context.set("mounted", (() => {
            const {mounted} = options;
            return Invocation(context.get('mounted'), null, mounted);
        })());

        context.set("beforeDestroy", (() => {
            const {beforeDestroy} = options;
            return Invocation(context.get('beforeDestroy'), null, beforeDestroy);
        })());

        context.set("destroyed", (() => {
            const {destroyed} = options;
            return Invocation(context.get('destroyed'), null, destroyed);
        })());
    }

    install(extender, context, options) {
        this.installBehaviorLifeCycle(extender, context, options);
        this.installCompatibleLifeCycle(extender, context, options);
        this.installOptionsLifeCycle(extender, context, options);
    }
}