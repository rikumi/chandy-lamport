import VirtualPeer, { connect } from './virtual-peer'

// 程序时间起点
export const START_TIME = Date.now()

// 伪延时函数，执行 await 调用时，效果与多线程下的 sleep() 类似
const sleep = t => new Promise(r => setTimeout(r, t));

(async () => {

  // 创建节点
  const i = new VirtualPeer('i', 100)
  const j = new VirtualPeer('j', 100)
  const k = new VirtualPeer('k', 100)

  // 连接各节点
  connect(i, j, 1000, 1300)
  connect(j, k, 2100, 2400)
  connect(i, k, 1600, 1900)

  // 测试事件序列
  i.initiateSnapshot(201)
  await sleep(700)

  j.initiatePayment(k, 35)
  await sleep(1200)

  i.initiateSnapshot(301)
  await sleep(1600)

  i.initiatePayment(j, 32)
  await sleep(800)
})()