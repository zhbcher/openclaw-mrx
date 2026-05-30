/**
 * Keyword Extractor — 从 Task 描述中提取检索关键词
 * 
 * 策略：
 *   1. 分词（中英文混合）
 *   2. 去停用词
 *   3. 提取技术词汇（框架名、工具名、协议名）
 *   4. 扩展同义词（增加召回率）
 */

// 中文停用词
const CN_STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "自己", "这", "他", "她", "它", "们", "那", "些", "什么", "怎么", "如何", "为什么",
  "可以", "这个", "那个", "已经", "还是", "或者", "但是", "因为", "所以", "如果",
  "需要", "应该", "可能", "能够", "通过", "进行", "使用", "实现", "完成", "开始",
]);

// 英文停用词
const EN_STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "through", "during", "before", "after",
  "this", "that", "these", "those", "it", "its", "and", "but", "or", "not",
  "no", "if", "then", "else", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "only",
]);

// 技术关键词字典（用于识别和扩展）
const TECH_SYNONYMS: Record<string, string[]> = {
  // 认证/鉴权
  "jwt": ["jwt", "token", "鉴权", "认证", "auth", "authentication", "oauth"],
  "auth": ["auth", "authentication", "认证", "鉴权", "jwt", "oauth", "token"],
  "登录": ["登录", "login", "signin", "auth", "认证", "jwt", "session"],
  
  // 数据库
  "数据库": ["数据库", "database", "db", "sql", "nosql", "存储"],
  "sqlite": ["sqlite", "sql", "database", "db", "wal"],
  "redis": ["redis", "缓存", "cache", "session", "内存"],
  "postgres": ["postgres", "postgresql", "sql", "database", "db"],
  
  // 前端
  "react": ["react", "jsx", "组件", "component", "前端", "frontend"],
  "vue": ["vue", "组件", "component", "前端", "frontend"],
  "css": ["css", "样式", "style", "动画", "animation", "布局", "layout"],
  "ui": ["ui", "界面", "页面", "组件", "样式", "css"],
  
  // API/网络
  "api": ["api", "接口", "rest", "graphql", "endpoint", "http"],
  "rest": ["rest", "api", "http", "接口", "endpoint"],
  "websocket": ["websocket", "ws", "实时", "realtime", "推送", "push"],
  
  // 工程
  "测试": ["测试", "test", "单元测试", "unittest", "集成测试", "e2e"],
  "部署": ["部署", "deploy", "ci", "cd", "cicd", "发布"],
  "构建": ["构建", "build", "编译", "compile", "打包", "bundle"],
  "重构": ["重构", "refactor", "迁移", "migrate", "重写"],
  "性能": ["性能", "performance", "优化", "optimize", "加速"],
  
  // Node.js
  "node": ["node", "nodejs", "express", "koa", "fastify"],
  "express": ["express", "node", "api", "中间件", "middleware"],
  
  // Next.js
  "next": ["next", "nextjs", "react", "ssr", "服务端渲染"],
  
  // AWS
  "serverless": ["serverless", "lambda", "云函数", "aws", "cloudflare"],
  "cloudflare": ["cloudflare", "workers", "pages", "d1", "边缘"],
};

export class KeywordExtractor {
  /**
   * 从 Task/Goal 描述中提取检索关键词
   */
  extract(text: string, maxKeywords: number = 8): string[] {
    // 1. 分词
    const tokens = this.tokenize(text);
    
    // 2. 去停用词
    const filtered = tokens.filter(t => !this.isStopWord(t) && t.length >= 2);
    
    // 3. 识别技术词汇
    const techWords = this.identifyTechWords(filtered);
    
    // 4. 合并普通词汇 + 技术词汇
    const allWords = [...new Set([...techWords, ...filtered])];
    
    // 5. 扩展同义词
    const expanded = this.expandSynonyms(allWords);
    
    // 6. 按重要性排序，取前 N 个
    return this.rankAndTrim(expanded, maxKeywords);
  }

  /**
   * 中英文混合分词
   */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    
    // 按标点和空格分割
    const segments = text.split(/[\s,，。.!！?？:：;；、()（）\[\]【】{}「」""''\-—/\\]+/);
    
    for (const seg of segments) {
      if (!seg) continue;
      
      // 混合段：分离中文连续块和英文/数字连续块
      const mixedParts = seg.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9_]+/g);
      if (!mixedParts) continue;
      
      for (const part of mixedParts) {
        if (/[\u4e00-\u9fff]/.test(part)) {
          // 纯中文：逐字 + bigram
          for (let i = 0; i < part.length; i++) {
            tokens.push(part[i]); // 单字
            if (i < part.length - 1) {
              tokens.push(part[i] + part[i + 1]); // bigram
            }
          }
        } else {
          // 纯英文/数字：保持完整
          tokens.push(part.toLowerCase());
        }
      }
    }
    
    return tokens;
  }

  private isStopWord(token: string): boolean {
    return CN_STOP_WORDS.has(token) || EN_STOP_WORDS.has(token);
  }

  /**
   * 识别技术词汇（匹配 TECH_SYNONYMS 字典）
   */
  private identifyTechWords(tokens: string[]): string[] {
    const found: string[] = [];
    
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (TECH_SYNONYMS[lower]) {
        found.push(...TECH_SYNONYMS[lower]);
      }
    }
    
    return found;
  }

  /**
   * 扩展同义词
   */
  private expandSynonyms(words: string[]): string[] {
    const expanded = new Set<string>();
    
    for (const word of words) {
      expanded.add(word);
      const lower = word.toLowerCase();
      if (TECH_SYNONYMS[lower]) {
        for (const syn of TECH_SYNONYMS[lower]) {
          expanded.add(syn);
        }
      }
    }
    
    return [...expanded];
  }

  /**
   * 排名并裁剪：优先技术词汇，然后按长度排序
   */
  private rankAndTrim(words: string[], max: number): string[] {
    const scored = words.map(w => {
      const lower = w.toLowerCase();
      let score = 0;
      
      // 技术词汇加分
      if (TECH_SYNONYMS[lower]) score += 3;
      // 长词加分（信息量更大）
      if (w.length > 4) score += 2;
      else if (w.length > 2) score += 1;
      // 纯中文加分
      if (/[\u4e00-\u9fff]/.test(w)) score += 1;
      
      return { word: w, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map(s => s.word);
  }
}
