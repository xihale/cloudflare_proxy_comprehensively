import defaultHtml from './default.html';

async function handleRequest(request: Request): Promise<Response> {
	try {
		const url = new URL(request.url);

		// ^\/https?%3A%2F%2F or ^\/https?://
		const path_regex = /^\/https?%3A%2F%2F|^\/https?:\//;

		// 如果访问根目录，返回 default.html
		if ( url.pathname === '/' ) {
			return new Response(defaultHtml, {
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
				},
			});
		}else if ( !path_regex.test(url.pathname) ) {
			// redirect to bing.com searching
			return new Response(null, {
				status: 302,
				headers: {
					'Location': `${url.protocol}//${url.host}/https://www.bing.com/search?q=${url.pathname.slice(1)}`,
				}
			});
		}

		// 从请求路径中提取目标 URL
		let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

		// 判断用户输入的 URL 是否带有协议
		actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

		// 保留查询参数
		actualUrlStr += url.search;

		// 创建新 Headers 对象，排除以 'cf-' 开头的请求头
		const newHeaders = filterHeaders(request.headers, (name) => !name.startsWith('cf-'));

		// 创建一个新的请求以访问目标 URL
		const modifiedRequest = new Request(actualUrlStr, {
			headers: newHeaders,
			method: request.method,
			body: request.body,
			redirect: 'manual',
		});

		// 发起对目标 URL 的请求

		// console.log(request.headers)

		const response = await fetch(modifiedRequest, {
			headers: request.headers,
		});
		let body: ReadableStream | string | null = response.body;

		// 处理重定向
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			body = response.body;
			// 创建新的 Response 对象以修改 Location 头部
			return handleRedirect(response, body as ReadableStream | string);
		} else if (response.headers.get('Content-Type')?.includes('text/html')) {
			body = await handleHtmlContent(response, url.protocol, url.host, actualUrlStr);
		}

		// 创建修改后的响应对象
		const modifiedResponse = new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});

		// 添加禁用缓存的头部
		setNoCacheHeaders(modifiedResponse.headers);

		// 添加 CORS 头部，允许跨域访问
		setCorsHeaders(modifiedResponse.headers);

		return modifiedResponse;
	} catch (error: any) {
		// 如果请求目标地址时出现错误，返回带有错误消息的响应和状态码 500（服务器错误）
		return jsonResponse(
			{
				error: error.message,
			},
			500,
		);
	}
}

// 确保 URL 带有协议
function ensureProtocol(url: string, defaultProtocol: string): string {
	return url.startsWith('http://') || url.startsWith('https://') ? url : defaultProtocol + '//' + url;
}

// 处理重定向
function handleRedirect(response: Response, body: ReadableStream | string): Response {
	const location = new URL(response.headers.get('location') || '');
	const modifiedLocation = `/${encodeURIComponent(location.toString())}`;
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: {
			...response.headers,
			Location: modifiedLocation,
		},
	});
}

// 处理 HTML 内容中的相对路径
async function handleHtmlContent(
	response: Response,
	protocol: string,
	host: string,
	actualUrlStr: string,
): Promise<string> {

	// verify charset
	// try to read as utf-8
	const arrayBuffer = await response.arrayBuffer();
	let decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
	let res = decoder.decode(arrayBuffer);

	if(res.includes("charset=gb2312")) {
		decoder = new TextDecoder('gb2312');
		res = decoder.decode(arrayBuffer);
		res = res.replace("charset=gb2312", "charset=utf-8"); // modify charset
	}


	// 为出现的新绝对路径的元素添加 ${protocol}//${host} 前缀
	const regex = new RegExp(`(href|src)="(https?://.*?)`, 'g');
	res = res.replace(regex, `$1="${protocol}//${host}/$2`);

	res = replaceRelativePaths(res, protocol, host, new URL(actualUrlStr).origin);

	return res;
}

// 替换 HTML 内容中的相对路径
function replaceRelativePaths(text: string, protocol: string, host: string, origin: string): string {
	const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
	return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

// 返回 JSON 格式的响应
function jsonResponse(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status: status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
		},
	});
}

// 过滤请求头
function filterHeaders(headers: Headers, filterFunc: (name: string) => boolean): Headers {
	return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

// 设置禁用缓存的头部
function setNoCacheHeaders(headers: Headers): void {
	headers.set('Cache-Control', 'no-store');
}

// 设置 CORS 头部
function setCorsHeaders(headers: Headers): void {
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
	headers.set('Access-Control-Allow-Headers', '*');
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRequest(request);
	},
} satisfies ExportedHandler<Env>;

