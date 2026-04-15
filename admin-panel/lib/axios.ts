import axios from 'axios'

axios.defaults.baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
axios.defaults.headers.common['Content-Type'] = 'application/json'

export default axios
