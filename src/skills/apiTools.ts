import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';

/**
 * Enhanced API tools for OrcBot.
 * Provides structured interaction with REST and GraphQL APIs.
 */
export function registerApiTools(agent: Agent) {
    
    /**
     * Perform a structured REST API request.
     * Supports automatic JSON handling, query parameters, and authentication (Bearer/Basic).
     */
    agent.skills.registerSkill({
        name: 'api_request',
        description: 'ULTIMATE API TOOL: Perform a structured REST API request (GET, POST, PUT, DELETE, etc). Handles JSON, custom headers, and Bearer/Basic auth automatically. Returns status, headers, and data. USE THIS for all API integrations instead of http_fetch.',
        usage: 'api_request({ url, method?, headers?, body?, params?, auth?, timeout? })',
        isParallelSafe: true,
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => {
            let { url, method = 'GET', headers = {}, body, params, auth, timeout = 30000 } = args;
            
            if (!url) return 'Error: url is required.';
            method = method.toUpperCase();

            // Resiliency: Parse headers if passed as a string
            if (typeof headers === 'string') {
                try {
                    headers = JSON.parse(headers);
                } catch (e) {
                    logger.warn(`Failed to parse headers string: ${headers}`);
                    headers = {};
                }
            }

            logger.info(`API Request: ${method} ${url}`);
            if (params) logger.debug(`API Params: ${JSON.stringify(params)}`);

            try {
                // Handle params (query string)
                if (params) {
                    const urlObj = new URL(url);
                    const paramsObj = typeof params === 'string' ? JSON.parse(params) : params;
                    Object.entries(paramsObj).forEach(([key, val]) => {
                        urlObj.searchParams.append(key, String(val));
                    });
                    url = urlObj.toString();
                }

                // Handle auth
                if (auth) {
                    const authObj = typeof auth === 'string' ? { type: 'bearer', token: auth } : auth;
                    if (authObj.type?.toLowerCase() === 'bearer') {
                        headers['Authorization'] = `Bearer ${authObj.token || authObj.key || authObj.value}`;
                    } else if (authObj.type?.toLowerCase() === 'basic') {
                        const user = authObj.username || authObj.user || '';
                        const pass = authObj.password || authObj.pass || '';
                        const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
                        headers['Authorization'] = `Basic ${encoded}`;
                    }
                }

                // Default headers
                if (!headers['User-Agent'] && !headers['user-agent']) {
                    headers['User-Agent'] = 'OrcBot/1.0';
                }
                if (!headers['Accept'] && !headers['accept']) {
                    headers['Accept'] = 'application/json, text/plain, */*';
                }

                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);

                const fetchOptions: RequestInit = {
                    method,
                    headers,
                    signal: controller.signal,
                    redirect: 'follow',
                };

                // Handle Body
                if (body && method !== 'GET' && method !== 'HEAD') {
                    if (typeof body === 'object') {
                        fetchOptions.body = JSON.stringify(body);
                        if (!headers['Content-Type'] && !headers['content-type']) {
                            (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
                        }
                    } else {
                        fetchOptions.body = String(body);
                    }
                }

                const response = await fetch(url, fetchOptions);
                clearTimeout(timer);

                const status = response.status;
                const statusText = response.statusText;
                const contentType = response.headers.get('content-type') || '';
                
                let responseData: any;
                if (contentType.includes('application/json')) {
                    try {
                        responseData = await response.json();
                    } catch {
                        responseData = await response.text();
                    }
                } else {
                    responseData = await response.text();
                }

                logger.info(`API Response: ${status} ${statusText} (${contentType})`);
                if (typeof responseData === 'object') {
                    logger.debug(`API Data: ${JSON.stringify(responseData).substring(0, 500)}...`);
                } else if (typeof responseData === 'string') {
                    logger.debug(`API Data: ${responseData.substring(0, 500)}...`);
                }

                const result = {
                    status,
                    statusText,
                    ok: response.ok,
                    headers: Object.fromEntries((response.headers as any).entries()),
                    data: responseData
                };

                const output = JSON.stringify(result, null, 2);
                const MAX_LEN = 15000;
                if (output.length > MAX_LEN) {
                    return output.substring(0, MAX_LEN) + `\n\n[... truncated, total size ${output.length} characters]`;
                }

                return output;
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    return `Error: API request to ${url} timed out after ${timeout}ms`;
                }
                return `Error performing API request: ${error.message}`;
            }
        }
    });

    // Shortcut: api_get
    agent.skills.registerSkill({
        name: 'api_get',
        description: 'Perform a GET request to an API endpoint with optional query parameters and auth.',
        usage: 'api_get({ url, params?, auth?, headers? })',
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => agent.skills.executeSkill('api_request', { ...args, method: 'GET' })
    });

    // Shortcut: api_post
    agent.skills.registerSkill({
        name: 'api_post',
        description: 'Perform a POST request to an API endpoint with a JSON body.',
        usage: 'api_post({ url, body, auth?, headers? })',
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => agent.skills.executeSkill('api_request', { ...args, method: 'POST' })
    });

    // Shortcut: api_put
    agent.skills.registerSkill({
        name: 'api_put',
        description: 'Perform a PUT request to an API endpoint.',
        usage: 'api_put({ url, body, auth?, headers? })',
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => agent.skills.executeSkill('api_request', { ...args, method: 'PUT' })
    });

    // Shortcut: api_delete
    agent.skills.registerSkill({
        name: 'api_delete',
        description: 'Perform a DELETE request to an API endpoint.',
        usage: 'api_delete({ url, params?, auth?, headers? })',
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => agent.skills.executeSkill('api_request', { ...args, method: 'DELETE' })
    });

    // Specialized: api_graphql
    agent.skills.registerSkill({
        name: 'api_graphql',
        description: 'Perform a GraphQL query or mutation.',
        usage: 'api_graphql({ url, query, variables?, auth?, headers? })',
        isResearch: true,
        isDeep: true,
        handler: async (args: any) => {
            const { url, query, variables, auth, headers = {} } = args;
            if (!url || !query) return 'Error: url and query are required.';
            
            return agent.skills.executeSkill('api_request', {
                url,
                method: 'POST',
                body: { query, variables },
                auth,
                headers
            });
        }
    });
}
