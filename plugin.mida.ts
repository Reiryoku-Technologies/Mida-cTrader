import { MyPlugin } from "!/src/core/MyPlugin";

export default new MyPlugin({
    id: "my-plugin", // Your plugin id, required.
    name: "My Plugin", // Your plugin name, required.
    version: "1.0.0", // Your plugin version, required.
    description: "This plugin does nothing.", // Your plugin description, optional.
});
