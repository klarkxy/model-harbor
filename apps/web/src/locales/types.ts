import en from './en.js';

type DeepString<T> = T extends string ? string : { [K in keyof T]: DeepString<T[K]> };

export type Messages = DeepString<typeof en>;
