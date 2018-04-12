import chalk from 'chalk'
import { START_TIME } from './controller' // 程序起始时间

//# 定义消息实体类
class Message {

  // - 资源转移中 type = 'resource', value 表示传送的资源数量
  // - 快照标签中 type = 'snapshot', value 为快照 id
  constructor(public type: 'resource' | 'snapshot', public value: number) {}

  toString() {
    return (this.type === 'resource' ? 
      chalk.green('资源') : 
      chalk.yellow('标签')
    ) + ' ' + this.value
  }
}

//# 定义虚拟连接类
//> 注：
//> Node.js 属于单线程语言，使用任务队列来模拟异步操作，使用 setTimeout() 可将任务加入任务队列；
//> 待当前同步代码段执行完毕，解释器等待设定的延时结束后，自动从事件队列取出下一个任务的同步代码段进行执行；
//> setTimeout() 中设定的延时只是一种意愿，实际执行任务的时间可能会由于同步代码的阻塞而比设定的延迟偏晚。
//> 利用这种事件机制，可以在对延时准确性要求不高的情况下，模拟多线程或多进程之间的交互。
class VirtualConnection {

  // 定义虚拟连接通道的本地端、远程端和通道延迟
  constructor(public local: VirtualPeer, public remote: VirtualPeer, public delay: number) {}

  // 模拟发送消息，实现为延时任务
  send(message: Message) {
    this.log(`发出 ${message}`)
    setTimeout(() => {
      this.log(`收到 ${message}`)
      this.remote.handleMessage(message, this.local)
    }, this.delay)
  }

  // 用于输出带有连接通道信息的日志
  log(...args: any[]) {
    let time = String(Date.now() - START_TIME)
    console.log(`${chalk.underline(time)} \t ${this.local} > ${this.remote}`, ...args)
  }
}

//# 定义快照任务类
//  快照任务定义为每个节点在每次快照下生成的一个 (1 * n) 向量；
//  每个节点在每次快照下均会生成一个快照任务实例，即它的生命周期为节点和快照的复合。
//- 对于每个节点实例，其 snapshotTasks 列表保存了当前它正在参与的所有快照任务；
//- 对于每次快照请求，每个节点中产生的快照任务的最终状态合并而成的 (n * n) 矩阵即为快照结果。
class SnapshotTask {

  // 当前节点的监听状态向量
  // 长度固定为 n - 1，元素顺序与节点的 connections 中各连接代表的远程节点顺序一致
  // 其中每个元素分别表示到当前节点的各通道上，是否已接收到该快照的标签消息
  // 逻辑上为对应通道监听状态的反值，即正在监听为 false，不再监听为 true
  public receiveStatus: boolean[]

  // 当前节点的快照向量
  // 长度固定为 n
  // {前 (n - 1) 个元素} 表示当前向量在监听其他各通道期间分别收到的资源总量
  // {最后一个元素} 表示当前向量在开始参与该快照任务时的资源量
  // 其中前 (n - 1) 个元素顺序与节点的 connections 中各连接代表的远程节点顺序一致
  public capturedResources: number[]

  // 快照编号，用于判断当前节点是否已参与某个快照
  constructor(public id: number) {}
}

//# 导出的节点类
export default class VirtualPeer {

  // 从该节点出发的所有当前连接
  public connections: VirtualConnection[] = []

  // 该节点参与的所有快照任务，每个快照任务中保存了对应的状态向量
  public snapshotTasks: SnapshotTask[] = []

  // 构造时传入节点名（用于输出）和节点资源初值
  constructor(public name: string, public resources: number) {}

  // 用于输出带有节点信息的日志
  log(...args: any[]) {
    let time = String(Date.now() - START_TIME)
    console.log(`${chalk.underline(time)} \t ${this}`, ...args)
  }

  // 节点收到消息时的处理
  handleMessage(message: Message, remote?: VirtualPeer) {

    // 收到的消息为快照标签
    if (message.type === 'snapshot') {

      // 先查找是否正在参与该快照
      let snapshot = this.snapshotTasks.find(k => k.id === message.value)

      // 若为新快照，建立对应的快照任务
      if (!snapshot) {
        snapshot = new SnapshotTask(message.value)

        // 初始化当前节点对当前快照的监听状态向量
        // 为了控制流的简洁，现在先全部置为 false（监听状态），稍后会立即对发来消息的通道关闭监听
        snapshot.receiveStatus = this.connections.map(k => false)

        // 初始化当前节点对当前快照的快照向量，前 (n - 1) 个元素置零，末尾元素保存当前元素资源量
        snapshot.capturedResources = this.connections.map(k => 0).concat(this.resources)

        // 将新建的快照任务保存到快照任务表中
        this.snapshotTasks.push(snapshot)
      }

      //<- 执行到此处时，snapshot 引用必然非空，指向当前消息所对应的快照任务实例。

      // 本程序把 Controller 要求某节点发起快照的消息当做节点间快照标签消息的特例：
      // 若 remote 为空，则为 Controller 发起的控制消息；
      if (!remote) { 

        // 此时当前节点即为快照的「发起者」，直接向所有通道转发该快照标签
        this.connections.map(k => k.send(message))
      }
      
      // 若 remote 不为空，则是节点间的交互消息。
      else {
        // 在当前节点的所有连接中，查找发送该消息的远程节点对应的连接
        let remoteIndex = this.connections.map(k => k.remote).indexOf(remote)

        // 若当前快照任务还未从该连接中收到快照标签，则可以停止监听该通道
        if (!snapshot.receiveStatus[remoteIndex]) {

          // 停止监听该通道
          snapshot.receiveStatus[remoteIndex] = true

          // 若当前节点的所有接收通道均停止监听，则当前节点完成对该快照的参与，输出当前节点的快照向量
          if (!snapshot.receiveStatus.filter(k => !k).length) {
            this.log(chalk.magenta(`快照 ${snapshot.id} 已完成：${snapshot.capturedResources}`))
          }
          
          // 否则，快照任务仍在继续，需要向所有外发通道转发该快照标签
          else {
            this.connections.map(k => k.send(message))
          }
        }
      }
    }
    
    // 收到的消息为资源转移
    else if (message.type === 'resource') {

      // 接收该资源转移，更新自身的资源量
      this.resources += message.value

      // 在当前节点的所有连接中，查找发送该消息的远程节点对应的连接
      let remoteIndex = this.connections.map(k => k.remote).indexOf(remote)

      // 对于当前节点正在参与且正在监听该通道的所有快照任务，在任务对应的快照向量中更新此通道收到的资源总量
      this.snapshotTasks.map(task => {
        if (!task.receiveStatus[remoteIndex]) {
          task.capturedResources[remoteIndex] += message.value
        }
      })
    }
  }

  // Controller 要求发起一个快照
  initiateSnapshot(id: number) {
    this.log(chalk.magenta(`发起快照 ${id}`))

    // 只需让当前节点假装收到一个没有发送者的快照标签消息
    this.handleMessage(new Message('snapshot', id))
  }

  // Controller 要求发起一笔资源转移
  initiatePayment(receiver: VirtualPeer, amount: number) {

    // 按照指定的数额减少自己的资源量
    this.resources -= amount

    // 向指定的节点发送资源转移消息
    let message = new Message('resource', amount)
    this.connections.find(k => k.remote === receiver).send(message)
  }

  toString() {
    return `${this.name}(${this.resources})`
  }
}

// 根据 Controller 要求，模拟两节点建立连接
export const connect = (a: VirtualPeer, b: VirtualPeer, delayab: number, delayba: number) => {
  a.connections.push(new VirtualConnection(a, b, delayab))
  b.connections.push(new VirtualConnection(b, a, delayba))
}