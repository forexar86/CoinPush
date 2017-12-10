import {Schema, model} from 'mongoose';

export const CandleSchema = new Schema({
	time: {
		type: Number,
		unique: true,
		required: true
	},
	data: {
		type: Schema.Types.Buffer,
		required: true
	}
});

export const Candle = model('Candle', CandleSchema);