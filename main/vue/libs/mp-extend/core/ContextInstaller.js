import OptionInstaller from './OptionInstaller';

import {Stream, Collectors} from '../libs/Stream';
import {isFunction, isPlainObject} from '../utils/common';
import {Singleton} from "../libs/Singleton";

/**
 * 兼容从this直接访问data的语法
 * this.data.id === this.id (true)
 */
export default class ContextInstaller extends OptionInstaller {
    compatibleContext = new Singleton((thisArg, properties) => {
        const runtimeContext = this.createRuntimeCompatibleContext(thisArg);
        const props = Object.keys(properties || {});
        return new Proxy(runtimeContext, {
            get(target, p, receiver) {
                if (p === '$props') {
                    return Stream.of(
                        Object.entries(Reflect.get(target, 'data'))
                    ).filter(([name]) => props.includes(name)).collect(Collectors.toMap());
                }
                if (p === '$data') {
                    return Stream.of(
                        Object.entries(Reflect.get(target, 'data'))
                    ).filter(([name]) => !props.includes(name)).collect(Collectors.toMap());
                }
                return Reflect.get(target, p, receiver);
            }
        });
    });

    install(extender, context, options) {
        const compatibleContext = this.compatibleContext;

        ['lifetimes', 'pageLifetimes', 'methods'].forEach(prop => {
            if (context.has(prop) && isPlainObject(context.get(prop))) {
                context.set(prop,
                    Stream.of(Object.entries(context.get(prop)))
                        .filter(([, func]) => isFunction(func))
                        .map(([name, func]) => {
                            return [name, function () {
                                console.log(this)
                                func.apply(compatibleContext.get(this, context.get('properties')), arguments);
                            }];
                        }).collect(Collectors.toMap())
                );
            }
        });

        [...context.keys()]
            .filter(i => !['data', 'beforeCreate'].includes(i) && isFunction(context.get(i)))
            .forEach(i => {
                context.set(i, (() => {
                        const func = context.get(i);
                        return function () {
                            func.apply(compatibleContext.get(this, context.get('properties')), arguments);
                        }
                    })()
                );
            });
    }
}