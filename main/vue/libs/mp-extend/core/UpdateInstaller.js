import OptionInstaller from "./OptionInstaller";
import {isFunction} from "../utils/common";

const SetDataSign = Symbol("__wxSetData__");

export default class UpdateInstaller extends OptionInstaller {
    definitionFilter(extender, context, options, defFields, definitionFilterArr) {
        const beforeUpdate = context.get("beforeUpdate");
        const updated = context.get("updated");

        defFields.behaviors = [
            Behavior({
                lifetimes: {
                    created() {
                        const originalSetData = this.setData;
                        context.set("originalSetData", (data, callback) => {
                            originalSetData.call(this, data, callback);
                        });
                        Object.defineProperty(this, SetDataSign, {
                            get() {
                                return originalSetData;
                            },
                            enumerable: false,
                            configurable: true
                        });
                        this.setData = (data, callback) => {
                            beforeUpdate(extender, context, options, this, data);
                            return Reflect.get(this, SetDataSign).call(this, data, function () {
                                updated(extender, context, options, this, data);
                                if (isFunction(callback)) {
                                    callback.call(this);
                                }
                            });
                        };
                    },
                    detached() {
                        this.setData = Reflect.get(this, SetDataSign);
                        Reflect.deleteProperty(this, SetDataSign);
                        context.delete("originalSetData");
                    }
                }
            })
        ].concat(defFields.behaviors || []);
    }

    install(extender, context, options) {
        const beforeUpdateChain = extender.installers.map(i => i.beforeUpdate.bind(i)).filter(i => !!i);
        const updatedChain = extender.installers.map(i => i.updated.bind(i)).filter(i => !!i);
        context.set("beforeUpdate", function (extender, context, options, instance, data) {
            beforeUpdateChain.forEach(i => i(extender, context, options, instance, data));
        });
        context.set("updated", function (extender, context, options, instance, data) {
            updatedChain.forEach(i => i(extender, context, options, instance, data));
        });
    }
}