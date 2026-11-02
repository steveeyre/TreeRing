import worker from '../../workers/api'

// Pages 自己负责静态资源，只有 /api/* 会被路由到 Functions（见 functions/api/ 目录名），
// 因此这里永远不会进入 Worker 的 env.ASSETS 分支。
export const onRequest = (ctx: any): Promise<Response> => worker.fetch(ctx.request, ctx.env)
