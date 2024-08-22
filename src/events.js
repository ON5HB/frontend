export default class SpectrumEvent {
  constructor (endpoint) {
    this.endpoint = endpoint
    this.signalClients = {}
    this.lastModified = performance.now()
  }

  init () {
    if (this.promise) {
      return this.promise
    }

    this.eventSocket = new WebSocket(this.endpoint)
    this.eventSocket.binaryType = 'arraybuffer'
    this.eventSocket.onmessage = this.socketMessage.bind(this)

    this.promise = new Promise((resolve, reject) => {
      this.eventSocket.onopen = resolve
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })

    return this.promise
  }

  socketMessage (event) {
    const data = JSON.parse(event.data)
    this.data = data
    if ('signal_list' in data) {
      this.signalClients = data.signal_list
    }
    if ('signal_changes' in data) {
      const signalChanges = data.signal_changes
      for (const [user, range] of Object.entries(signalChanges)) {
        if (range[0] === -1 && range[1] === -1) {
          delete this.signalClients[user]
        } else {
          this.signalClients[user] = range
        }
      }
    }
 
    if ('waterfall_clients' in data) {
      if(data.signal_clients > 1)
      {
        document.getElementById('total_user_count').innerHTML = `
          <span class="text-fuchsia-400 font-medium">${data.signal_clients} Users</span>
          <span class="text-blue-500 font-medium">[${parseInt(data.waterfall_kbits + data.audio_kbits)} kbit/s] </span>
        `;
      }else
      {
        document.getElementById('total_user_count').innerHTML = `
          <span class="text-fuchsia-400 font-medium">${data.signal_clients} User</span>
          <span class="text-blue-500 font-medium">[${parseInt(data.waterfall_kbits + data.audio_kbits)} kbit/s] </span>
        `;
      }
    }
    this.lastModified = performance.now()
  }

  setUserID (userID) {
    this.eventSocket.send(JSON.stringify({
      cmd: 'userid',
      userid: userID
    }))
  }

  getSignalClients () {
    let signalClients = {}
    Object.assign(signalClients, this.signalClients)
    return signalClients
  }

  getLastModified () {
    return this.lastModified
  }
}
