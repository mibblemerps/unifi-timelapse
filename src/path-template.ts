import {Nullable} from "unifi-protect";
import {getWeek} from "./week";

export function inflate(path: string, vars: Map<string, string>, date: Nullable<Date> = null): string {
    const dateString = (date ?? new Date()).toISOString()
        .replaceAll(':', '_')
        .replaceAll('T', ' ')
        .replaceAll('Z', '');

    vars.set('date', dateString);
    vars.set('week', getWeek(date ?? new Date()).toString());

    for (let key of vars.keys()) {
        path = path.replaceAll('%' + key + '%', vars.get(key) ?? '');
    }

    return path;
}

