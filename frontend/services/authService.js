import axios from "axios";

const API = "http://localhost:8000/auth";

export const register = async (data) => {
  return axios.post(`${API}/register`, data);
};