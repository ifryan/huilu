/** 响应丢失不等于投递失败；后台按会议 ID 持久去重，因此只对断连安全重试。 */
export async function sendResultNotification(send: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await send()
      return
    } catch (error) {
      const disconnected =
        error instanceof Error &&
        /message port closed|message channel closed|receiving end does not exist|could not establish connection/i.test(
          error.message,
        )
      if (!disconnected || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}
