import typescript from 'rollup-plugin-typescript2';

export default {
    input: 'src/tag2cloud.ts',
    output: {
        format: 'umd',
        name: 'tag2cloud',
        file: './dist/index.js',
    },
    plugins: [
        typescript({
            tsconfig: 'tsconfig.json'
        })
    ]
}